import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withStoreLock } from './store-lock.js';
import { withActionLock } from './action-lock.js';
import { validateCampaign, campaignBase } from './outreach.js';
import { requireCampaignCopy } from './outreach-copy.js';
import { loadAction, loadItem, loadSources, loadPolicies, loadSettings, saveAction, saveItem, logEvent } from './storage.js';
import { makeItem } from './models.js';
import { evaluatePolicy } from './policy.js';
import { inspectEmailHistory, replaceEmailDraft } from './adapters/email.js';
import { readJson, writeJsonAtomic, sha256, stableStringify } from './util.js';

export async function reviseCampaign(root, campaign, dependencies={}) {
  validateCampaign(campaign);requireCampaignCopy([...(campaign.review_context || []),...campaign.prospects]);
  const fingerprint=sha256(stableStringify(campaign));
  return withStoreLock(root,()=>withActionLock(root,async()=>{
    const base=await campaignBase(root,campaign), state=await readJson(join(base,'state.json'));
    if(!state?.prospects) throw new Error('existing campaign required');
    const journalPath=join(base,`revision-${fingerprint}.json`);
    const journal=await readJson(journalPath,null);
    if(journal?.status==='complete') return state;
    if(journal) throw new Error('unfinished revision; reconcile external effects before retry');
    for (const name of await readdir(base)) {
      if (name.startsWith('revision-') && name.endsWith('.json') && (await readJson(join(base,name)))?.status !== 'complete') throw new Error('unfinished revision; reconcile before starting another revision');
    }
    if(Object.keys(state.prospects).length!==campaign.prospects.length || campaign.prospects.some(p=>!state.prospects[p.canonical_id])) throw new Error('revision must preserve campaign membership');
    const source=(await loadSources(root)).find(s=>s.id===campaign.source_id);
    if(!source?.enabled || source.type!=='email' || source.config.username.toLowerCase()!==campaign.sender_email.toLowerCase()) throw new Error('sender mismatch');
    const suppressions=await readJson(join(root,'outreach-suppressions.json'),[]);
    if(!Array.isArray(suppressions)||suppressions.some(s=>typeof s?.identity!=='string')) throw new Error('invalid suppressions');
    const policies=await loadPolicies(root),settings=await loadSettings(root);
    const plans=[];
    for(const p of campaign.prospects){
      const record=state.prospects[p.canonical_id],old=await loadAction(root,record.action_id),item=await loadItem(root,record.item_id);
      if(!old||!item||old.type!=='draft_response'||old.source_id!==source.id||old.metadata?.outreach?.campaign_id!==campaign.id||old.metadata?.outreach?.canonical_id!==p.canonical_id) throw new Error('revision identity mismatch');
      if(old.metadata?.campaign_review || old.metadata?.campaign_delivery || old.metadata?.delivery) throw new Error('Operator-edited or sent campaign messages must use the campaign editor; automated revision is disabled');
      if(!['executed','needs_review'].includes(old.status)) throw new Error('draft state requires reconciliation');
      if((item.author_email||null)!==(p.email||null)) throw new Error('recipient changes require separate verification');
      if(suppressions.some(s=>[p.canonical_id,p.email,...p.identity_terms].filter(Boolean).map(x=>x.toLowerCase()).includes(s.identity.toLowerCase()))) throw new Error('recipient suppressed');
      if(old.status==='executed'){
        if(!p.eligible||old.metadata.outreach.holds?.length||!record.receipt?.uid) throw new Error('remote draft not eligible for editing');
        const policy=evaluatePolicy({item,actionType:'append_remote_draft',policies,settings,source});
        if(!policy.allowed||policy.blocked) throw new Error('draft revision blocked by policy');
        const history=await (dependencies.history||inspectEmailHistory)(source,[...p.identity_terms,p.email]);
        if(!history.complete||!Array.isArray(history.matches)||history.matches.some(m=> !(m.mailbox===(source.config.drafts_mailbox||'Drafts') && String(m.uid)===String(record.receipt.uid)) && !(record.revision_receipts||[]).some(r=>r.archived_uid && m.mailbox===r.archived_to && String(m.uid)===String(r.archived_uid)))) throw new Error('new correspondence or another draft requires relationship review');
      }
      const metadata={...old.metadata,subject:p.subject,draft_message_id:`<outreach-${sha256(old.id+fingerprint)}@${campaign.sender_email.split('@')[1]}>`,outreach:{...old.metadata.outreach,content_hash:sha256(stableStringify(p)),qa:p.qa,copy_review:p.copy_review,sources:p.sources,revision:campaign.copy_revision,send_blocked:true}};
      const next={...old,body:p.body,metadata,approved_at:null,approved_by:null};
      plans.push({p,record,old,item,next});
    }
    const j={status:'pending',fingerprint,started_at:new Date().toISOString(),previous_state:structuredClone(state),previous_campaign:await readJson(join(base,'campaign-input.json')),plans:plans.map(({p,old,item})=>({id:p.canonical_id,old_action:old,old_item:item})),completed:[]};
    await writeJsonAtomic(journalPath,j);
    for(const {p,record,old,item,next} of plans){
      if(old.status==='executed') {
        next.result=await (dependencies.replace||replaceEmailDraft)(source,old,next,item);
        j.remote_receipts ||= {};j.remote_receipts[p.canonical_id]=next.result;
        await writeJsonAtomic(journalPath,j);
      }
      const nextItem=makeItem({...item,title:p.subject,body:p.body,normalized_text:undefined,metadata:next.metadata,updated_at:new Date().toISOString()});
      await saveItem(root,nextItem);await saveAction(root,next);
      if (old.status==='executed') record.revision_receipts=[...(record.revision_receipts||[]),next.result];
      record.receipt=next.result;record.status=old.status==='executed'?'DRAFTED':(p.email?'NEEDS_VERIFICATION':'NEEDS_CONTACT_ROUTE');record.copy_revision=campaign.copy_revision;record.approval_status='AWAITING_REVIEW';
      state.events.push({at:new Date().toISOString(),event:'copy_revised',prospect_id:p.canonical_id,action_id:old.id,policy:p.copy_review.policy,score:p.qa.score,previous_uid:old.result?.uid||null,uid:next.result?.uid||null});
      j.completed.push(p.canonical_id);await writeJsonAtomic(journalPath,j);
      await logEvent(root,'audit',{event_type:'outreach_copy_revised',action_id:old.id,item_id:item.id,status:'draft_only'});
    }
    state.config_hash=fingerprint;state.copy_revision=campaign.copy_revision;
    await writeJsonAtomic(join(base,'state.json'),state);
    await writeJsonAtomic(join(base,'campaign-input.json'),campaign);
    await writeJsonAtomic(join(base,'campaign.json'),campaign);
    j.status='complete';j.completed_at=new Date().toISOString();await writeJsonAtomic(journalPath,j);
    return state;
  }));
}

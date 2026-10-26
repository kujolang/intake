import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore, saveSources, savePolicies, loadAction, saveAction, loadItem, loadSources, listActions } from '../src/storage.js';
import { makeSource } from '../src/models.js';
import { draftCampaign } from '../src/outreach.js';
import { sendApprovedOutreach } from '../src/outreach-send.js';
import { outreachDeliveryFingerprint, deliverApprovedOutreach, sendEmailResponse } from '../src/adapters/email.js';
import { readJson, writeJsonAtomic } from '../src/util.js';
import { prospect } from './helpers/outreach-copy.js';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'intake-send-'));t.after(()=>rm(root,{recursive:true,force:true}));await initStore(root);
 await saveSources(root,[makeSource('email',{id:'mail',config:{username:'sender@example.com'}})]);
 await savePolicies(root,[{id:'test',scope:'global',allowed_actions:['append_remote_draft','draft_response'],blocked_actions:['send_response'],requires_human_review:true,auto_execute:false}]);
 const c={id:'TEST',mode:'DRAFT',sending_authorized:false,source_id:'mail',sender_email:'sender@example.com',prospects:[prospect()]};
 const state=await draftCampaign(root,c,{history:async()=>({complete:true,matches:[]}),execute:async id=>{const a=await loadAction(root,id);a.status='executed';a.result={uid:'42',appended_to:'Drafts'};await saveAction(root,a);return a;}});
 const r=state.prospects['ASH-TEST'],a=await loadAction(root,r.action_id),i=await loadItem(root,r.item_id),s=(await loadSources(root))[0];
 const manifest={intent:'SEND_EXACT_REVIEWED_DRAFTS',campaign_id:'TEST',source_id:'mail',approved_by:'Fixture operator',approved_at:new Date().toISOString(),authorization:'Send this exact reviewed draft',entries:[{action_id:a.id,fingerprint:outreachDeliveryFingerprint(s,a,i)}]};
 const deps={history:async()=>({complete:true,matches:[{mailbox:'Drafts',uid:'42'}]}),verify:async()=>({ok:true,uid:'42'}),deliver:async(s,a,i,f,record)=>{const r={message_id:a.metadata.draft_message_id,accepted:[i.author_email],sent_copy_verified:true};await record({status:'smtp_returned',smtp:r});return r;}};
 return {root,manifest,deps,a,i,s};
}
test('explicit delivery preserves draft IDs, records separate send action and completed replay is inert',async t=>{
 const {root,manifest,deps,a}=await fixture(t);let calls=0;const deliver=deps.deliver;deps.deliver=async(...args)=>{calls++;return deliver(...args);};
 const result=await sendApprovedOutreach(root,manifest,deps);assert.equal(result.status,'complete');
 assert.equal((await loadAction(root,a.id)).type,'draft_response');assert.equal((await listActions(root)).filter(a=>a.type==='send_response'&&a.status==='executed').length,1);
 await sendApprovedOutreach(root,manifest,deps);assert.equal(calls,1);
 await assert.rejects(sendApprovedOutreach(root,{...manifest,approved_at:'different'},deps),/previously submitted/);
});
for(const failure of ['changed','correspondence','suppressed','uncertain'])test(`send fails closed: ${failure}`,async t=>{
 const {root,manifest,deps,a}=await fixture(t);let calls=0;
 deps.deliver=async(s,a,i,f,record)=>{calls++;await record({status:'smtp_returned',smtp:{accepted:[i.author_email]}});throw Error('cleanup uncertain');};
 if(failure==='changed') await saveAction(root,{...a,body:'changed'});
 if(failure==='correspondence') deps.history=async()=>({complete:true,matches:[{mailbox:'INBOX',uid:'99'}]});
 if(failure==='suppressed') await writeJsonAtomic(join(root,'outreach-suppressions.json'),[{identity:'ASH-TEST'}]);
 await assert.rejects(sendApprovedOutreach(root,manifest,deps));
 if(failure==='uncertain'){
  await assert.rejects(sendApprovedOutreach(root,manifest,deps),/already started/);
  await assert.rejects(sendApprovedOutreach(root,{...manifest,approved_at:'new'},deps),/existing send action/);
  const j=await readJson(join(root,'campaigns/TEST',(await readdir(join(root,'campaigns/TEST'))).find(n=>n.startsWith('delivery-'))));assert.equal(j.deliveries['ASH-TEST'].smtp.accepted.length,1);
 }
 assert.equal(calls,failure==='uncertain'?1:0);
});
for(const failure of [null,'append','receipt'])test(`SMTP receipt precedes cleanup: ${failure||'success'}`,async t=>{
 process.env.INTAKE_SEND_FIXTURE='fixture';t.after(()=>delete process.env.INTAKE_SEND_FIXTURE);
 const source={id:'mail',secret_ref:'env:INTAKE_SEND_FIXTURE',config:{username:'sender@example.com'}},action={id:'draft',type:'draft_response',body:'Exact approved body',metadata:{subject:'A subject',draft_message_id:'<draft@example.com>',outreach:{holds:[]}}},item={id:'item',author_email:'owner@example.com'};
 let mailbox,sentRaw,moved=false,sends=0,receipt=false;
 const draft=Buffer.from('From: sender@example.com\r\nTo: owner@example.com\r\nSubject: A subject\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nExact approved body');
 for(const method of ['connect','logout'])t.mock.method(ImapFlow.prototype,method,async()=>{});
 t.mock.method(ImapFlow.prototype,'list',async()=>[{path:'Archive/Outreach Sent Drafts'}]);
 t.mock.method(ImapFlow.prototype,'getMailboxLock',async path=>{mailbox=path;return {release(){}};});
 t.mock.method(ImapFlow.prototype,'search',async()=>mailbox==='Sent'?(sentRaw?[5]:[]):moved?[]:[42]);
 t.mock.method(ImapFlow.prototype,'fetchOne',async()=>({source:mailbox==='Sent'?sentRaw:draft,flags:new Set(['\\Draft'])}));
 t.mock.method(ImapFlow.prototype,'append',async(path,raw)=>{assert.ok(receipt);if(failure==='append')throw Error('append failed');sentRaw=raw;});
 t.mock.method(ImapFlow.prototype,'messageMove',async()=>{moved=true;return {uidMap:new Map([[42,6]])};});
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async opts=>{sends++;assert.deepEqual(opts.envelope.to,['owner@example.com']);return {accepted:['owner@example.com'],rejected:[]};},close(){}}));
 const run=()=>deliverApprovedOutreach(source,action,item,outreachDeliveryFingerprint(source,action,item),async()=>{receipt=true;if(failure==='receipt')throw Error('journal failed');});
 if(failure)await assert.rejects(run());else assert.equal((await run()).sent_copy_verified,true);
 assert.equal(sends,1);assert.equal(moved,!failure);
 await assert.rejects(sendEmailResponse(source,action,item),/disabled/);
});

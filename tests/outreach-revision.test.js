import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { initStore, saveSources, savePolicies, loadAction, saveAction, loadItem } from '../src/storage.js';
import { makeSource } from '../src/models.js';
import { draftCampaign } from '../src/outreach.js';
import { reviseCampaign } from '../src/outreach-revision.js';
import { replaceEmailDraft } from '../src/adapters/email.js';
import { startDashboard } from '../src/dashboard.js';
import { proposeDraft } from '../src/workflow.js';
import { readJson } from '../src/util.js';
import { prospect, sign } from './helpers/outreach-copy.js';
async function fixture(t, held=false){
 const root=await mkdtemp(join(tmpdir(),'intake-revise-'));t.after(()=>rm(root,{recursive:true,force:true}));await initStore(root);
 await saveSources(root,[makeSource('email',{id:'mail',config:{username:'sender@example.com'}})]);
 await savePolicies(root,[{id:'test',scope:'global',scope_id:null,allowed_actions:['append_remote_draft','draft_response'],blocked_actions:['send_response'],requires_human_review:true,auto_execute:false}]);
 const c={id:'TEST',mode:'DRAFT',sending_authorized:false,source_id:'mail',sender_email:'sender@example.com',prospects:[prospect()]};
 if(held){c.prospects[0].email=null;c.prospects[0].eligible=false;c.prospects[0].contact_status='UNKNOWN';}
 const state=await draftCampaign(root,c,{history:async()=>({complete:true,matches:[]}),execute:async id=>{const a=await loadAction(root,id);a.status='executed';a.result={uid:'42'};await saveAction(root,a);return a;}});
 c.copy_revision=2;c.prospects[0].subject='Preparing for a family class';sign(c.prospects);
 return {root,c,state,history:async()=>({complete:true,matches:[{mailbox:'Drafts',uid:'42'}]})};
}
test('revision preserves local IDs, receipts, previous state and never repeats remote replacement',async t=>{
 const {root,c,state,history}=await fixture(t);let calls=0;
 const replace=async()=>{calls++;return {uid:'43',replaced_uid:'42'};};
 const next=await reviseCampaign(root,c,{history,replace});const record=next.prospects['ASH-TEST'];
 assert.equal(record.action_id,state.prospects['ASH-TEST'].action_id);assert.equal(record.item_id,state.prospects['ASH-TEST'].item_id);
 assert.equal((await loadAction(root,record.action_id)).approved_at,null);assert.equal((await loadItem(root,record.item_id)).body,c.prospects[0].body);
 const journal=await readJson(join(root,'campaigns','TEST',(await readdir(join(root,'campaigns','TEST'))).find(n=>n.startsWith('revision-'))));
 assert.equal(journal.previous_state.prospects['ASH-TEST'].receipt.uid,'42');assert.equal(journal.remote_receipts['ASH-TEST'].uid,'43');
 await reviseCampaign(root,c,{history,replace});assert.equal(calls,1);
 await assert.rejects(proposeDraft(root,record.item_id,{body:'Generic replacement'}),/reviewed campaign/);
});
test('uncertain replacement stops retries; new correspondence blocks revisions',async t=>{
 const {root,c,history}=await fixture(t);
 await assert.rejects(reviseCampaign(root,c,{history:async()=>({complete:true,matches:[{mailbox:'Sent',uid:'99'}]})}),/correspondence/);
 let calls=0;await assert.rejects(reviseCampaign(root,c,{history,replace:async()=>{calls++;throw Error('uncertain');}}),/uncertain/);
 await assert.rejects(reviseCampaign(root,c,{history,replace:async()=>{calls++;}}),/unfinished revision/);assert.equal(calls,1);
 c.copy_revision=3;await assert.rejects(reviseCampaign(root,c,{history}),/unfinished revision/);
});
for(const failure of [null,'old-changed','append','readback'])test(`IMAP revision ${failure||'success'} keeps the old draft until verified and never invokes SMTP`,async t=>{
 process.env.INTAKE_REVISION_FIXTURE='fixture';t.after(()=>delete process.env.INTAKE_REVISION_FIXTURE);
 const source={id:'mail',secret_ref:'env:INTAKE_REVISION_FIXTURE',config:{username:'sender@example.com'}};
 const previous={type:'draft_response',body:'old body',metadata:{subject:'Old subject',draft_message_id:'<old@example.com>'}};
 const next={type:'draft_response',body:'new body',metadata:{subject:'New subject',draft_message_id:'<new@example.com>',outreach:{mode:'DRAFT',holds:[]}}};
 const item={author_email:'owner@example.com'};let appended=false,moved=false,reads=0;
 const raw=a=>Buffer.from(`From: sender@example.com\r\nTo: owner@example.com\r\nSubject: ${a.metadata.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.body}`);
 t.mock.method(nodemailer,'createTransport',()=>{throw Error('SMTP forbidden');});
 for(const method of ['connect','logout'])t.mock.method(ImapFlow.prototype,method,async()=>{});
 t.mock.method(ImapFlow.prototype,'list',async()=>[{path:'Archive/Outreach Revisions'}]);
 t.mock.method(ImapFlow.prototype,'getMailboxLock',async()=>({release(){}}));
 t.mock.method(ImapFlow.prototype,'search',async q=>q.header['Message-ID'].startsWith('<old')?(moved?[]:[42]):(appended?[43]:[]));
 t.mock.method(ImapFlow.prototype,'fetchOne',async uid=>{reads++;const a=uid===42?previous:next;return {flags:new Set(['\\Draft']),source:raw({...a,body:failure===(uid===42?'old-changed':'readback')?'unexpected user edit':a.body})};});
 t.mock.method(ImapFlow.prototype,'append',async()=>{if(failure==='append')throw Error('append failed');appended=true;return {uidValidity:1};});
 t.mock.method(ImapFlow.prototype,'messageMove',async()=>{assert.equal(reads,2);moved=true;return true;});
 if(failure){await assert.rejects(replaceEmailDraft(source,previous,next,item));assert.equal(moved,false);if(failure==='old-changed')assert.equal(appended,false);}
 else {const r=await replaceEmailDraft(source,previous,next,item);assert.equal(r.uid,'43');assert.equal(r.replaced_uid,'42');assert.equal(moved,true);}
});

test('held proposal stays unaddressed and dashboard controls cannot bypass review',async t=>{
 const {root,c,state}=await fixture(t,true);const next=await reviseCampaign(root,c,{replace:async()=>{throw Error('remote write forbidden');}});
 const r=next.prospects['ASH-TEST'];assert.equal(r.status,'NEEDS_CONTACT_ROUTE');assert.equal(r.action_id,state.prospects['ASH-TEST'].action_id);assert.equal((await loadItem(root,r.item_id)).author_email,null);
 const d=await startDashboard(root,{port:0,token:'test-token'});t.after(()=>new Promise(resolve=>d.server.close(resolve)));
 for(const [path,payload] of [['/api/actions',{item_id:r.item_id,body:'bad'}],['/api/actions/'+r.action_id+'/update',{body:'bad'}],['/api/items/'+r.item_id+'/draft',{body:'bad'}]]){
   const response=await fetch('http://'+d.host+':'+d.port+path,{method:'POST',headers:{'x-intake-token':'test-token','content-type':'application/json'},body:JSON.stringify(payload)});
   assert.equal(response.ok,false);assert.match(await response.text(),/reviewed campaign/);
 }
});

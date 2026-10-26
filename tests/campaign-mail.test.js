import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { initStore, loadAction, loadItem, saveAction, saveSources } from '../src/storage.js';
import { readJson, writeJsonAtomic } from '../src/util.js';
import { startDashboard } from '../src/dashboard.js';
import { seedCampaignMail } from './helpers/campaign-mail.js';
import { approveAction, runAction } from '../src/workflow.js';

async function setup(t, options = {}) {
 const root = await mkdtemp(join(tmpdir(),'intake-campaign-mail-'));
 await initStore(root); const fixture = await seedCampaignMail(root, options);
 process.env.INTAKE_TEST_CAMPAIGN_PASSWORD = 'fixture';
 let count = 0, sent;
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{count++;sent=mail;if(options.fail)throw new Error('SMTP connection lost');return {messageId:'<sent@test>',accepted:[fixture.item.author_email],rejected:[]};},close(){}}));
 const dashboard = await startDashboard(root,{port:0,token:'test'});
 t.after(async()=>{await new Promise(r=>dashboard.server.close(r));await rm(root,{recursive:true,force:true});delete process.env.INTAKE_TEST_CAMPAIGN_PASSWORD;});
 const base = `http://127.0.0.1:${dashboard.port}`;
 const current = async()=> (await (await fetch(base+'/api/items/'+fixture.item.id+'/mail',{headers:{'x-intake-token':'test'}})).json()).actions[0];
 const post = async(command,payload={})=>{const r=await fetch(base+'/api/mail/'+command+'/'+fixture.action.id,{method:'POST',headers:{'x-intake-token':'test','content-type':'application/json'},body:JSON.stringify(payload)});return {http:r.status,...await r.json()};};
 return {root,...fixture,current,post,count:()=>count,sent:()=>sent};
}

test('operator saves, approves and confirms exact campaign content once; preserves draft identity and receipts',async t=>{
 const f=await setup(t); let a=await f.current();
 assert.equal((await f.post('send',{version:a.version,confirm:true})).http,400);
 assert.equal((await f.post('approve',{version:a.version})).http,400);
 const saved=await f.post('save',{version:a.version,subject:'Edited subject',body:'Edited message',to:f.item.author_email});
 assert.equal(saved.http,200);assert.equal(saved.action.id,a.id);assert.deepEqual(saved.action.result,{uid:42,mailbox:'Drafts'});
 assert.equal((await loadItem(f.root,f.item.id)).body,'Edited message');
 const approved=await f.post('approve',{version:saved.version,reviewed:true});assert.equal(approved.action.metadata.campaign_review.status,'approved');
 assert.equal(f.count(),0);
 assert.equal((await f.post('send',{version:approved.version})).http,400);
 const edited=await f.post('save',{version:approved.version,subject:'Final subject',body:'Final message'});
 assert.equal(edited.action.metadata.campaign_review.status,'needs_review');
 assert.equal((await f.post('send',{version:approved.version,confirm:true})).http,409);
 assert.equal((await f.post('send',{version:edited.version,confirm:true})).http,400);
 const ready=await f.post('approve',{version:edited.version,reviewed:true});
 const sends=await Promise.all([f.post('send',{version:ready.version,confirm:true}),f.post('send',{version:ready.version,confirm:true})]);
 assert.equal(sends.filter(r=>r.http===200).length,1);assert.equal(f.count(),1);
 assert.equal(f.sent().to,f.item.author_email);assert.equal(f.sent().subject,'Final subject');assert.equal(f.sent().text,'Final message');
 assert.equal(f.sent().inReplyTo,undefined);
 a=await f.current();assert.equal(a.metadata.campaign_delivery.status,'sent');
 assert.equal((await f.post('send',{version:a.version,confirm:true})).http,409);
 assert.equal((await f.post('save',{version:a.version,subject:'Too late',body:'Too late'})).http,409);
 assert.equal((await readJson(join(f.base,'state.json'))).prospects[f.prospect.canonical_id].status,'SENT');
 await approveAction(f.root,a.id);await assert.rejects(runAction(f.root,a.id),/campaign editor/);assert.equal(f.count(),1);
});

test('campaign send rechecks suppressions, sender identity, holds and pending revisions',async t=>{
 const f=await setup(t);let a=await f.current();
 const approved=await f.post('approve',{version:a.version,reviewed:true});
 await writeJsonAtomic(join(f.root,'outreach-suppressions.json'),[{identity:f.item.author_email}]);
 assert.match((await f.post('send',{version:approved.version,confirm:true})).error,/suppressed/);
 await writeJsonAtomic(join(f.root,'outreach-suppressions.json'),[]);
 await saveSources(f.root,[{...f.source,config:{...f.source.config,from:'other@example.test'}}]);
 assert.match((await f.post('send',{version:approved.version,confirm:true})).error,/sender changed/);
 await saveSources(f.root,[f.source]);
 await writeJsonAtomic(join(f.base,'revision-pending.json'),{status:'pending'});
 assert.equal((await f.post('send',{version:approved.version,confirm:true})).http,409);
 await rm(join(f.base,'revision-pending.json'));
 a=await loadAction(f.root,f.action.id);a.metadata.outreach.holds=['Relationship review'];await saveAction(f.root,a);
 a=await f.current();assert.match((await f.post('send',{version:a.version,confirm:true})).error,/holds/);
 assert.equal(f.count(),0);
});

test('uncertain campaign delivery survives reopen and prevents retry',async t=>{
 const f=await setup(t,{fail:true});const a=await f.current();
 const approved=await f.post('approve',{version:a.version,reviewed:true});
 const sent=await f.post('send',{version:approved.version,confirm:true});
 assert.equal(sent.action.metadata.campaign_delivery.status,'uncertain');
 const reopened=await f.current();assert.equal((await f.post('send',{version:reopened.version,confirm:true})).http,409);
 assert.equal((await readJson(join(f.base,'state.json'))).prospects[f.prospect.canonical_id].status,'DELIVERY_UNCERTAIN');assert.equal(f.count(),1);
});

test('missing or unverified campaign recipient cannot be approved',async t=>{
 const f=await setup(t,{prospect:{eligible:false,contact_status:'UNKNOWN'}});const a=await f.current();
 assert.match((await f.post('approve',{version:a.version,reviewed:true})).error,/verified, eligible/);assert.equal(f.count(),0);
});

test('UI refuses a delivery already started by the reviewed-batch workflow',async t=>{
 const f=await setup(t);const a=await f.current();
 const approved=await f.post('approve',{version:a.version,reviewed:true});
 await saveAction(f.root,{...f.action,id:'act_prior_delivery',type:'send_response',status:'execution_uncertain'});
 assert.match((await f.post('send',{version:approved.version,confirm:true})).error,/delivery already exists/);assert.equal(f.count(),0);
});

test('a crash marker and an approval for changed content cannot be retried',async t=>{
 const f=await setup(t);let a=await f.current();
 await f.post('approve',{version:a.version,reviewed:true});
 a=await loadAction(f.root,f.action.id);await saveAction(f.root,{...a,body:'Changed outside the editor'});
 a=await f.current();assert.match((await f.post('send',{version:a.version,confirm:true})).error,/Approve this exact/);
 const approved=await f.post('approve',{version:a.version,reviewed:true});
 await saveAction(f.root,{...approved.action,metadata:{...approved.action.metadata,campaign_delivery:{status:'sending'}}});
 a=await f.current();assert.equal((await f.post('send',{version:a.version,confirm:true})).http,409);assert.equal(f.count(),0);
});

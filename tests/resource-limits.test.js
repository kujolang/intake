import test from 'node:test';
import assert from 'node:assert/strict';
import { readBounded, resourceLimit } from '../src/resource-limits.js';
import { classifyWithAi } from '../src/ai.js';
import { syncFileSource } from '../src/adapters/file.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore } from '../src/storage.js';

test('bounded streams reject excess bytes and close the iterator',async()=>{
 let closed=false;
 async function* chunks(){try{yield Buffer.alloc(4);yield Buffer.alloc(4);}finally{closed=true;}}
 await assert.rejects(()=>readBounded(chunks(),6,'fixture'),/exceeds/);
 assert.equal(closed,true);
 for(const value of [0,-1,Infinity,'bad',2.5])assert.throws(()=>resourceLimit(value,4,'limit'));
});

test('AI requests have cancellation and reject oversized input and response',async t=>{
 const old=globalThis.fetch; t.after(()=>{globalThis.fetch=old;delete process.env.INTAKE_RESOURCE_TEST_KEY;});
 process.env.INTAKE_RESOURCE_TEST_KEY='synthetic';
 const settings={ai_enabled:true,ai_provider:'openai-compatible',ai_base_url:'https://example.test',ai_api_key_env:'INTAKE_RESOURCE_TEST_KEY'};
 let signal;
 globalThis.fetch=async(url,options)=>{signal=options.signal;return new Response('x'.repeat(20));};
 await assert.rejects(()=>classifyWithAi({body:'hello'},{...settings,ai_max_input_bytes:2}),/input exceeds/);
 await assert.rejects(()=>classifyWithAi({body:'hello'},{...settings,ai_max_response_bytes:10}),/response exceeds/);
 assert.ok(signal instanceof AbortSignal);
 globalThis.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 // Keep the event loop alive while the unref'ed production timeout fires.
 const keepAlive=setInterval(()=>{},1000);t.after(()=>clearInterval(keepAlive));
 await assert.rejects(()=>classifyWithAi({body:'hello'},{...settings,ai_timeout_ms:10}),{name:'TimeoutError'});
});

test('file byte limits skip oversize files and batch without losing pending files',async t=>{
 const base=await mkdtemp(join(tmpdir(),'intake-limits-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const root=join(base,'store'),folder=join(base,'files');await initStore(root);await mkdir(folder);
 await writeFile(join(folder,'a.txt'),'a'.repeat(11));await writeFile(join(folder,'b.txt'),'b'.repeat(8));await writeFile(join(folder,'c.txt'),'c'.repeat(8));
 const source={id:'files',config:{path:folder,max_file_bytes:10,max_batch_bytes:10}};
 const first=await syncFileSource(root,source);assert.equal(first.items.length,1);
 const second=await syncFileSource(root,{...source,cursor:first.cursor});assert.equal(second.items.length,1);
 assert.notEqual(first.items[0].id,second.items[0].id);
});

test('IMAP requests bounded literals and releases mailbox on oversized messages',async t=>{
 const {ImapFlow}=await import('imapflow');
 const {syncEmailSource}=await import('../src/adapters/email.js');
 let released=false,loggedOut=false,closed=false;
 t.mock.method(ImapFlow.prototype,'connect',async function(){this.mailbox={uidNext:3};});
 t.mock.method(ImapFlow.prototype,'getMailboxLock',async()=>({release(){released=true;}}));
 t.mock.method(ImapFlow.prototype,'logout',async()=>{loggedOut=true;});
 t.mock.method(ImapFlow.prototype,'close',()=>{closed=true;});
 t.mock.method(ImapFlow.prototype,'fetch',async function*(range,query){
   assert.deepEqual(query.source,{start:0,maxLength:11});
   yield {uid:1,source:Buffer.alloc(11)};
 });
 process.env.INTAKE_RESOURCE_MAIL_KEY='synthetic';t.after(()=>delete process.env.INTAKE_RESOURCE_MAIL_KEY);
 const source={id:'mail',secret_ref:'env:INTAKE_RESOURCE_MAIL_KEY',config:{username:'test@example.test',max_message_bytes:10},cursor:{uid:0}};
 await assert.rejects(()=>syncEmailSource('unused',source),/max_message_bytes/);
 assert.equal(source.cursor.uid,0);assert.equal(released,true);assert.equal(loggedOut,false);assert.equal(closed,true);
});

test('source inputs preserve explicit resource limits and reject invalid values',async()=>{
 const {buildSourceFromInput}=await import('../src/source-config.js');
 const source=buildSourceFromInput({type:'file',id:'bounded',path:'.',maxFileBytes:'2048',maxBatchItems:'4'});
 assert.equal(source.config.max_file_bytes,2048);assert.equal(source.config.max_batch_items,4);
 assert.throws(()=>buildSourceFromInput({type:'file',maxBatchBytes:0}),/positive integer/);
});

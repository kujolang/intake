import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { initStore, logEvent } from '../src/storage.js';
import { withStoreLock } from '../src/store-lock.js';

const base=await mkdtemp(join(tmpdir(),'intake-lock-bench-'));
const results={events:1000,trials:3,standalone_ms:[],transaction_ms:[]};
try{
 for(let trial=0;trial<3;trial++){
  for(const mode of trial%2 ? ['transaction','standalone'] : ['standalone','transaction']){
   const root=join(base,`${mode}-${trial}`);await initStore(root);
   const write=async()=>{for(let i=0;i<results.events;i++)await logEvent(root,'audit',{event_type:'benchmark',sequence:i});};
   const start=performance.now();
   if(mode==='transaction')await withStoreLock(root,write);else await write();
   results[`${mode}_ms`].push(Math.round(performance.now()-start));
   const rows=(await readFile(join(root,'logs','audit.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
   assert.equal(rows.length,results.events);
   assert.deepEqual(rows.map(row=>row.sequence),Array.from({length:results.events},(_,i)=>i));
  }
 }
 console.log(JSON.stringify(results,null,2));
}finally{await rm(base,{recursive:true,force:true});}

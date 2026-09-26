import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withStoreLock, recoverStoreLock } from '../src/store-lock.js';
import { initStore, loadSettings, saveSettings, saveSources, listItems, loadSources } from '../src/storage.js';
import { makeSource } from '../src/models.js';
import { syncOne } from '../src/workflow.js';

async function setup(t) {
  const base = await mkdtemp(join(tmpdir(), 'intake-lock-test-'));
  t.after(() => rm(base, {recursive:true, force:true}));
  const root = join(base, 'store');
  await initStore(root);
  return { root, base };
}

test('store transactions serialize read-modify-write and permit awaited nesting', async t => {
  const {root} = await setup(t);
  await Promise.all(Array.from({length:20}, () => withStoreLock(root, async () => {
    const settings = await loadSettings(root);
    await saveSettings(root, {...settings, count:(settings.count || 0)+1});
  })));
  assert.equal((await loadSettings(root)).count,20);
});

test('another process cannot read or write through an active transaction', async t => {
  const {root} = await setup(t);
  await withStoreLock(root, async () => {
    const result = spawnSync(process.execPath,['--input-type=module','-e', `import {loadSettings} from './src/storage.js';try {await loadSettings(${JSON.stringify(root)});process.exitCode=2;}catch(e){console.log(e.code);}`],{encoding:'utf8'});
    assert.equal(result.status,0);
    assert.match(result.stdout,/INTAKE_STORE_BUSY/);
  });
  await loadSettings(root);
});

test('crashed owner blocks access until explicit recovery; active owner cannot be stolen', async t => {
  const {root} = await setup(t);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {withStoreLock} from './src/store-lock.js';await withStoreLock(${JSON.stringify(root)},async()=>{process.stdout.write('locked');await new Promise(()=>{});});`],{stdio:['ignore','pipe','pipe']});
  await once(child.stdout,'data');
  const exited=once(child,'exit');
  // Node exits with unresolved top-level await, deliberately leaving its lock.
  await exited;
  await assert.rejects(()=>loadSettings(root),{code:'INTAKE_STORE_BUSY'});
  await recoverStoreLock(root,()=>saveSettings(root,{recovered:true}));
  assert.equal((await loadSettings(root)).recovered,true);
  await withStoreLock(root,async()=> {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {recoverStoreLock} from './src/store-lock.js';try{await recoverStoreLock(${JSON.stringify(root)},async()=>{});process.exitCode=2;}catch(e){console.log(e.message)}`],{encoding:'utf8'});
    assert.equal(result.status,0);
    assert.match(result.stdout,/still running/);
  });
});

test('failed classification preserves cursor and retries missing items without losing indexed successes', async t => {
  const {root,base}=await setup(t);
  await writeFile(join(base,'a.txt'),'First test message');
  await writeFile(join(base,'b.txt'),'Second test message');
  const source=makeSource('file',{id:'files',config:{path:base}});
  await saveSources(root,[source]);
  const settings=await loadSettings(root);
  await saveSettings(root,{...settings,ai_enabled:true,ai_provider:'openai-compatible',ai_base_url:'https://example.test',ai_api_key_env:'INTAKE_LOCK_TEST_KEY'});
  process.env.INTAKE_LOCK_TEST_KEY='synthetic';
  t.after(()=>delete process.env.INTAKE_LOCK_TEST_KEY);
  let calls=0;
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{ if(++calls===2)throw new Error('synthetic provider failure');return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"classified"}'}}]}));};
  await assert.rejects(()=>syncOne(root,source),/synthetic provider failure/);
  assert.equal((await listItems(root)).length,1);
  assert.deepEqual((await loadSources(root))[0].cursor,source.cursor);
  await syncOne(root,source);
  assert.equal((await listItems(root)).length,2);
  assert.equal(calls,3);
});

test('maintenance and config mutation refuse an active writer in another process',async t=>{
 const {root,base}=await setup(t);
 await withStoreLock(root,async()=>{
   const program=`import {createBackup} from './src/backup.js';import {applyRetention} from './src/retention.js';import {saveSettings} from './src/storage.js';const root=${JSON.stringify(root)};for(const op of [()=>createBackup(root,{output:${JSON.stringify(join(base,'backup.gz'))}}),()=>applyRetention(root,{}),()=>saveSettings(root,{})]){try{await op();process.exitCode=2;}catch(e){if(e.code!=='INTAKE_STORE_BUSY')throw e;}}`;
   const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
 });
});

test('CLI recovery rebuilds indexes from durable records',async t=>{
 const {root}=await setup(t);
 const {makeItem}=await import('../src/models.js');
 const {saveItem}=await import('../src/storage.js');
 await saveItem(root,makeItem({id:'survivor',body:'persisted'}));
 await writeFile(join(root,'index','items.json'),'[]');
 const result=spawnSync(process.execPath,['bin/intake.js','store','recover','--dir',root],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).ok,true);
 assert.equal((await listItems(root)).length,1);
 const {listItemIndex}=await import('../src/storage.js');
 assert.equal((await listItemIndex(root))[0].id,'survivor');
});

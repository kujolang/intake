import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup } from "../src/backup.js";
import { initStore, loadSettings, saveSettings } from "../src/storage.js";

async function setup(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-recovery-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  return { base, root };
}

for (const boundary of ["building", "previous", "installed"]) {
  test(`restore recovers after process exit at ${boundary} rename`, async (t) => {
    const { base, root } = await setup(t);
    await saveSettings(root, { marker: "archive" });
    const archive = join(base, "backup.gz");
    await createBackup(root, { output: archive });
    await saveSettings(root, { marker: "original" });
    const script = `
      import fs from 'node:fs/promises';
      import {syncBuiltinESMExports} from 'node:module';
      const rename=fs.rename;
      fs.rename=async(from,to)=>{ await rename(from,to);
        if (${JSON.stringify(boundary)}==='building' ? String(to).endsWith('.intake-restore.json') : ${JSON.stringify(boundary)}==='previous' ? String(to).includes('.previous-') : String(from).includes('.restore-') && String(to).endsWith("/store")) process.exit(77);
      };
      syncBuiltinESMExports();
      const {restoreBackup}=await import('./src/backup.js');
      await restoreBackup(${JSON.stringify(archive)},${JSON.stringify(root)},{force:true});
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
    assert.equal(child.status, 77, child.stderr);
    const recovered = spawnSync(process.execPath, ["bin/intake.js", "store", "recover", "--dir", root], { encoding: "utf8", timeout: 20000 });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal((await loadSettings(root)).marker, boundary === "installed" ? "archive" : "original");
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual((await readdir(base)).filter((name) => /\.(previous|restore)-|intake-restore/.test(name)), []);
  });
}

test("nested alias lock cannot wait behind a queued independent alias request", async (t) => {
  const { base, root } = await setup(t);
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const root=${JSON.stringify(root)}, alias=${JSON.stringify(join(base, "alias"))};
    await fs.symlink(root,alias);
    let identified;
    const identityReady=new Promise(r=>identified=r);
    const realpath=fs.realpath;
    fs.realpath=async(path,...args)=>{const result=await realpath(path,...args);if(path===alias)identified();return result;};
    syncBuiltinESMExports();
    const {withStoreLock}=await import('./src/store-lock.js');
    let release, entered;
    const ready=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
    const first=withStoreLock(root,async()=>{ entered();await gate;await withStoreLock(alias,async()=>{}); });
    await ready;
    const second=withStoreLock(alias,async()=>{});
    await identityReady;release();
    await Promise.all([first,second]);
    console.log('completed');
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /completed/);
});

test("appending after an interrupted JSONL record preserves the next event", async (t) => {
  const { root } = await setup(t);
  const { writeFile } = await import("node:fs/promises");
  const { logEvent } = await import("../src/storage.js");
  const { readLogPage } = await import("../src/logs.js");
  const path = join(root, "logs", "audit.jsonl");
  await writeFile(path, '{"event_type":"interrupted');
  await logEvent(root, "audit", { event_type: "after_recovery" });
  const rows = await readLogPage(path);
  assert.equal(rows[0].event_type, "after_recovery");
  assert.equal(rows[1].parse_error, true);
  assert.equal(rows[1].line, '{"event_type":"interrupted');
});

test("restore through a symlink preserves the alias and replaces the canonical store", async (t) => {
  const { root, base } = await setup(t);
  const { restoreBackup } = await import("../src/backup.js");
  await saveSettings(root, { marker: "archive" });
  const path = join(base, "archive.gz");
  await createBackup(root, { output: path });
  await saveSettings(root, { marker: "old" });
  const alias = join(base, "alias");
  await symlink(root, alias);
  const result = await restoreBackup(path, alias, { force: true });
  assert.equal(result.restored_to, alias);
  assert.equal(await realpath(alias), await realpath(root));
  assert.equal((await loadSettings(root)).marker, "archive");
});

test("invalid restore journals block normal access and forced recovery without deleting evidence", async (t) => {
  const { root } = await setup(t);
  const canonical = await realpath(root);
  const journal = `${canonical}.intake-restore.json`;
  await writeFile(journal, '{"version":1,"nonce":"../outside"}');
  await assert.rejects(() => loadSettings(root), { code: "INTAKE_STORE_BUSY" });
  const { recoverStoreLock } = await import("../src/store-lock.js");
  let called = false;
  await assert.rejects(() => recoverStoreLock(root, async () => { called = true; }, { force: true }), /invalid restore journal/);
  assert.equal(called, false);
  assert.equal(await readFile(journal, "utf8"), '{"version":1,"nonce":"../outside"}');
});

test("record committed before an interrupted index update is recovered without replay", async (t) => {
  const { root } = await setup(t);
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{await rename(from,to);if(String(to).endsWith('/items/survivor.json'))process.exit(77);};
    syncBuiltinESMExports();
    const {saveItem}=await import('./src/storage.js');
    const {makeItem}=await import('./src/models.js');
    await saveItem(${JSON.stringify(root)},makeItem({id:'survivor',body:'committed'}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 77, child.stderr);
  await assert.rejects(() => loadSettings(root), { code: "INTAKE_STORE_BUSY" });
  const recovered = spawnSync(process.execPath, ["bin/intake.js", "store", "recover", "--dir", root], { encoding: "utf8", timeout: 20000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  const { listItemIndex, loadItem } = await import("../src/storage.js");
  assert.equal((await listItemIndex(root))[0].id, "survivor");
  assert.equal((await loadItem(root, "survivor")).body, "committed");
});

test("a failed install rolls back the original and preserves the primary error", async (t) => {
  const { root, base } = await setup(t);
  const path = join(base, "archive.gz");
  await saveSettings(root, { marker: "archive" });
  await createBackup(root, { output: path });
  await saveSettings(root, { marker: "original" });
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{if(String(from).includes('.restore-') && String(to).endsWith('/store'))throw new Error('install fault');return rename(from,to);};
    syncBuiltinESMExports();
    const {restoreBackup}=await import('./src/backup.js');
    try { await restoreBackup(${JSON.stringify(path)},${JSON.stringify(root)},{force:true});process.exitCode=2; }
    catch(error){if(error.message!=='install fault')throw error;}
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal((await loadSettings(root)).marker, "original");
});

test("recovery completes a prepared restore into a previously absent target", async (t) => {
  const { root, base } = await setup(t);
  const path = join(base, "archive.gz"), target = join(base, "new-store");
  await saveSettings(root, { marker: "archive" });
  await createBackup(root, { output: path });
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{await rename(from,to);if(String(to).endsWith('.intake-restore.json') && JSON.parse(await fs.readFile(to,'utf8')).phase==='ready')process.exit(77);};
    syncBuiltinESMExports();
    const {restoreBackup}=await import('./src/backup.js');
    await restoreBackup(${JSON.stringify(path)},${JSON.stringify(target)});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 77, child.stderr);
  const recovered = spawnSync(process.execPath, ["bin/intake.js", "store", "recover", "--dir", target], { encoding: "utf8", timeout: 20000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal((await loadSettings(target)).marker, "archive");
});

test("legacy interrupted restores refuse to initialize over a missing original store", async (t) => {
  const { root } = await setup(t);
  const { rename } = await import("node:fs/promises");
  const { recoverStoreLock } = await import("../src/store-lock.js");
  await saveSettings(root, { marker: "original" });
  const previous = `${root}.previous-legacy`;
  await rename(root, previous);
  let called = false;
  await assert.rejects(() => recoverStoreLock(root, async () => { called = true; await initStore(root); }), /unjournaled interrupted restore/);
  assert.equal(called, false);
  assert.equal(JSON.parse(await readFile(join(previous, "config", "settings.json"), "utf8")).marker, "original");
});

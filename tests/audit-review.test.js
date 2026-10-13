import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup } from "../src/backup.js";
import { initStore, saveSettings, loadSettings } from "../src/storage.js";
import { applyRetention } from "../src/retention.js";

async function setup(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-review-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  return { base, root };
}

test("dangling aliases retain canonical ownership and recover an interrupted restore", async (t) => {
  const { base, root } = await setup(t);
  await saveSettings(root, { marker: "archive" });
  const archive = join(base, "archive.gz");
  await createBackup(root, { output: archive });
  await saveSettings(root, { marker: "original" });
  const alias = join(base, "alias"), outer = join(base, "outer");
  await symlink("store", alias);
  await symlink("alias", outer);
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{await rename(from,to);if(String(to).includes('.previous-'))process.exit(77);};
    syncBuiltinESMExports();
    const {restoreBackup}=await import('./src/backup.js');
    await restoreBackup(${JSON.stringify(archive)},${JSON.stringify(outer)},{force:true});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 77, child.stderr);
  await assert.rejects(() => loadSettings(outer), { code: "INTAKE_STORE_BUSY" });
  const recovered = spawnSync(process.execPath, ["bin/intake.js", "store", "recover", "--dir", outer], { encoding: "utf8", timeout: 20000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal((await loadSettings(outer)).marker, "original");
  const { readlink } = await import("node:fs/promises");
  assert.equal(await readlink(alias), "store");
  assert.equal(await readlink(outer), "alias");
});

test("attachment special files cannot block the store lock during open", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX FIFOs are unavailable on Windows");
  const { root } = await setup(t);
  const path = join(root, "raw", "attachments", "fifo");
  await mkdir(join(root, "raw", "attachments"), { recursive: true });
  const fifo = spawnSync("mkfifo", [path], { encoding: "utf8" });
  assert.equal(fifo.status, 0, fifo.stderr);
  const script = `
    import assert from 'node:assert/strict';
    import {readQuarantinedAttachment} from './src/attachments.js';
    await assert.rejects(()=>readQuarantinedAttachment(${JSON.stringify(root)},{id:'fixture',attachments:[{quarantined:true,quarantine_path:'raw/attachments/fifo'}]},0),/not a file/);
    console.log('rejected');
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 0, child.stderr || String(child.error));
  assert.match(child.stdout, /rejected/);
});

test("raw retention refuses a linked root before deleting external files", async (t) => {
  const { root, base } = await setup(t);
  const outside = join(base, "external");
  await mkdir(outside);
  const payload = join(outside, "keep.txt");
  await writeFile(payload, "keep");
  await utimes(payload, new Date("2000-01-01"), new Date("2000-01-01"));
  await rm(join(root, "raw"), { recursive: true });
  await symlink(outside, join(root, "raw"));
  await assert.rejects(() => applyRetention(root, { rawDays: 1 }), /unsafe raw/);
  assert.equal(await readFile(payload, "utf8"), "keep");
});

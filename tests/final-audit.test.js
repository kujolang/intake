import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initStore, loadLearning, saveLearning } from "../src/storage.js";
import { makeLearning, makeSource } from "../src/models.js";
import { buildSourceFromInput } from "../src/source-config.js";
import { exportStrataDaily } from "../src/exports.js";
import { createBackup, verifyBackup } from "../src/backup.js";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-final-audit-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  return { root, base };
}

test("editing source configuration preserves server-owned readiness and sync history", () => {
  const history = { last_tested_at: "2026-01-01", last_test_result: { ok: true }, test_history: [{ ok: true }], last_synced_at: "2026-01-02", last_sync_result: { saved_count: 1 }, sync_history: [{ saved_count: 1 }] };
  const original = { ...makeSource("file", { id: "drop", config: { path: "/tmp/drop" }, cursor: { seen: ["file"] } }), ...history };
  const next = buildSourceFromInput({ name: "Renamed", test_history: [], last_test_result: { ok: false } }, original);
  for (const key of Object.keys(history)) assert.deepEqual(next[key], history[key], key);
  assert.deepEqual(next.cursor, original.cursor);
  assert.equal(next.name, "Renamed");
});

test("Strata exports contain every learning marked as exported", async (t) => {
  const { root } = await fixture(t);
  for (const type of ["general", "custom-lesson", "item_learning"]) {
    const learning = makeLearning({ id: type, type, title: `Title ${type}`, summary: `Evidence ${type}`, status: "accepted" });
    await saveLearning(root, learning);
  }
  const output = await exportStrataDaily(root);
  const text = await readFile(output, "utf8");
  for (const type of ["general", "custom-lesson", "item_learning"]) {
    assert.equal((await loadLearning(root, type)).exported_to_strata, true);
    assert.ok(text.includes(`Evidence ${type}`), `${type} must actually be in the exported note`);
  }
});

test("backup rotation tolerates a candidate disappearing during its header read", async (t) => {
  const { root, base } = await fixture(t);
  const old = join(base, "old.json.gz"), output = join(base, "new.json.gz");
  await createBackup(root, { output: old });
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const read=fs.createReadStream;
    fs.createReadStream=(path,...args)=>{if(path===${JSON.stringify(old)})fs.rmSync(path);return read(path,...args);};
    syncBuiltinESMExports();
    const {createBackup}=await import('./src/backup.js');
    await createBackup(${JSON.stringify(root)},{output:${JSON.stringify(output)},keep:1});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal((await verifyBackup(output)).ok, true);
});

test("backup rotation tolerates a candidate disappearing after its header read", async (t) => {
  const { root, base } = await fixture(t);
  const old = join(base, "old.json.gz"), output = join(base, "new.json.gz");
  await createBackup(root, { output: old });
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const stat=fs.stat;
    fs.stat=async(path,...args)=>{if(path===${JSON.stringify(old)})await fs.rm(path);return stat(path,...args);};
    syncBuiltinESMExports();
    const {createBackup}=await import('./src/backup.js');
    await createBackup(${JSON.stringify(root)},{output:${JSON.stringify(output)},keep:1});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal((await verifyBackup(output)).ok, true);
});

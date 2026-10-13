import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSource } from "../src/models.js";
import { initStore, listItems, listItemIndex, loadItem, saveItem, saveRules, rebuildItemIndex } from "../src/storage.js";
import { normalizeWebhookPayload } from "../src/adapters/webhook.js";
import { receiveItem } from "../src/workflow.js";

const source = makeSource("webhook", { id: "recovery", config: { token: "fixture" } });
const payload = { id: "delivery", title: "Question", body: "Help" };
const event = "webhook_received";
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-receiver-recovery-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  return root;
}
function receive(root) { return receiveItem(root, source, payload, normalizeWebhookPayload, event); }

for (const boundary of ["raw", "item", "index"]) {
  test(`receiver recovers a process exit after the ${boundary} commit`, async (t) => {
    const root = await fixture(t);
    const script = `
      import fs from 'node:fs/promises';
      import {sep} from 'node:path';
      import {syncBuiltinESMExports} from 'node:module';
      const rename=fs.rename;
      fs.rename=async(from,to)=>{
        await rename(from,to);
        const path=String(to).split(sep).join('/');
        const boundary=${JSON.stringify(boundary)};
        if ((boundary==='raw' && path.includes('/raw/webhooks/')) ||
            (boundary==='item' && path.includes('/items/')) ||
            (boundary==='index' && path.endsWith('/index/items.json'))) process.exit(77);
      };
      syncBuiltinESMExports();
      const {receiveItem}=await import('./src/workflow.js');
      const {normalizeWebhookPayload}=await import('./src/adapters/webhook.js');
      await receiveItem(${JSON.stringify(root)},${JSON.stringify(source)},${JSON.stringify(payload)},normalizeWebhookPayload,${JSON.stringify(event)});
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
    assert.equal(child.status, 77, child.stderr);
    await assert.rejects(() => receive(root), { code: "INTAKE_STORE_BUSY" });
    const recovered = spawnSync(process.execPath, ["bin/intake.js", "store", "recover", "--dir", root], { encoding: "utf8", timeout: 20000 });
    assert.equal(recovered.status, 0, recovered.stderr);
    let committed;
    if (boundary !== "raw") {
      [committed] = await listItems(root);
      assert.ok(committed.last_processed_at);
      committed = { ...committed, status: "resolved", assigned_human: "operator" };
      await saveItem(root, committed);
      // A committed receipt must not evaluate rules again, even if config is now broken.
      await saveRules(root, { invalid: true });
    } else assert.equal((await listItems(root)).length, 0);
    const item = await receive(root);
    if (committed) assert.deepEqual(item, committed);
    assert.equal((await listItems(root)).length, 1);
    assert.equal((await listItemIndex(root))[0].id, item.id);
    assert.equal((await readdir(join(root, "raw", "webhooks", source.id))).length, 1);
    assert.deepEqual(JSON.parse(await readFile(join(root, item.raw_payload_path), "utf8")), payload);
    assert.equal((await receive(root)).id, item.id);
  });
}

test("receiver retries an index write failure without repeating classification", async (t) => {
  const root = await fixture(t);
  const index = join(root, "index", "items.json");
  await rm(index, { force: true });
  await mkdir(index);
  await assert.rejects(() => receive(root));
  const [committed] = await listItems(root);
  assert.ok(committed.last_processed_at);
  await rm(index, { recursive: true });
  await saveRules(root, { invalid: true });
  assert.deepEqual(await receive(root), committed);
  assert.equal((await listItemIndex(root))[0].id, committed.id);
});

test("receiver preserves malformed authoritative evidence and refuses to replace it", async (t) => {
  const root = await fixture(t);
  const item = await receive(root);
  const path = join(root, "items", `${item.id}.json`);
  await writeFile(path, '{"interrupted":');
  await assert.rejects(() => receive(root), /cannot read JSON/);
  assert.equal(await readFile(path, "utf8"), '{"interrupted":');
  await assert.rejects(() => loadItem(root, item.id), /cannot read JSON/);
});

test("receiver does not treat malformed JSON values as a missing receipt", async (t) => {
  const root = await fixture(t);
  const item = await receive(root);
  const path = join(root, "items", `${item.id}.json`);
  for (const value of [null, false, 0, "", [], {}, { ...item, id: "different-item" }]) {
    const evidence = JSON.stringify(value);
    await writeFile(path, evidence);
    await assert.rejects(() => receive(root), /invalid stored item identity/);
    assert.equal(await readFile(path, "utf8"), evidence);
  }
});

test("receiver refuses inconsistent or unclassified receipt records", async (t) => {
  const root = await fixture(t);
  const item = await receive(root);
  const path = join(root, "items", `${item.id}.json`);
  for (const invalid of [
    { ...item, source_id: "other-source" },
    { ...item, metadata: { ...item.metadata, receipt_hash: "wrong" } },
    { ...item, last_processed_at: null }
  ]) {
    const evidence = JSON.stringify(invalid);
    await writeFile(path, evidence);
    await assert.rejects(() => receive(root), /invalid stored receiver receipt/);
    assert.equal(await readFile(path, "utf8"), evidence);
  }
});


test("index recovery refuses malformed authoritative records without dropping indexed evidence", async (t) => {
  const root = await fixture(t);
  const item = await receive(root);
  const index = join(root, "index", "items.json");
  const before = await readFile(index, "utf8");
  await writeFile(join(root, "items", `${item.id}.json`), "null");
  await assert.rejects(() => rebuildItemIndex(root), /invalid stored item identity/);
  assert.equal(await readFile(index, "utf8"), before);
});

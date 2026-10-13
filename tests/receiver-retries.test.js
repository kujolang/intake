import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSource } from "../src/models.js";
import { initStore, listItems, loadItem, saveItem, loadRules, saveRules, listItemIndex } from "../src/storage.js";
import { startWebhookServer } from "../src/adapters/webhook.js";
import { startSlackServer, signSlackTestBody } from "../src/adapters/slack.js";
import { startIssueWebhookServer, signGitHubBody } from "../src/adapters/issues.js";
import { readLogPage } from "../src/logs.js";

async function fixture(t, type) {
  const root = await mkdtemp(join(tmpdir(), "intake-retries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = makeSource(type, { id: type, config: { token: "fixture", signing_secret: "fixture" } });
  await initStore(root);
  const start = type === "webhook" ? startWebhookServer : type === "slack" ? startSlackServer : startIssueWebhookServer;
  const receiver = await start(root, source, { port: 0 });
  t.after(() => new Promise((resolve) => receiver.server.close(resolve)));
  async function post(payload) {
    const body = JSON.stringify(payload);
    let headers = { "content-type": "application/json", authorization: "Bearer fixture" };
    if (type === "slack") {
      const signed = signSlackTestBody(body, "fixture");
      headers = { ...headers, "x-slack-signature": signed.signature, "x-slack-request-timestamp": signed.timestamp };
    } else if (type === "github") headers["x-hub-signature-256"] = signGitHubBody(body, "fixture");
    return fetch(receiver.url, { method: "POST", headers, body });
  }
  return { root, post, source, receiver };
}

for (const type of ["webhook", "slack", "github"]) {
  test(`${type} retries preserve operator state and changed events remain distinct`, async (t) => {
    const { root, post } = await fixture(t, type);
    const payload = type === "webhook" ? { id: "one", title: "Question", body: "Help" }
      : type === "slack" ? { event_id: "one", event: { type: "message", ts: "1700000000.1", channel: "C1", user: "U1", text: "Help" } }
      : { action: "opened", repository: { full_name: "example/repo" }, issue: { id: 1, number: 1, title: "Question", body: "Help" } };
    const first = await post(payload);
    assert.equal(first.status, 202);
    const { item_id } = await first.json();
    await saveItem(root, { ...await loadItem(root, item_id), assigned_human: "operator", status: "resolved", queue: "resolved" });
    const retries = await Promise.all(Array.from({ length: 3 }, () => post(payload)));
    for (const retry of retries) {
      assert.equal(retry.status, 202);
      assert.equal((await retry.json()).item_id, item_id);
    }
    assert.equal((await listItems(root)).length, 1);
    assert.equal((await loadItem(root, item_id)).assigned_human, "operator");
    assert.equal((await loadItem(root, item_id)).status, "resolved");
    assert.equal((await readLogPage(join(root, "logs", "classify.jsonl"))).length, 1);
    // Same native entity, but different payload: do not lose later changes.
    const changed = structuredClone(payload);
    if (type === "webhook") changed.body = "Changed";
    else if (type === "slack") changed.event.text = "Changed";
    else changed.action = "closed";
    const next = await post(changed);
    assert.equal(next.status, 202);
    assert.notEqual((await next.json()).item_id, item_id);
    assert.equal((await listItems(root)).length, 2);
    assert.equal((await loadItem(root, item_id)).status, "resolved");
  });
}

test("receiver retries classification failures instead of accepting a partial receipt", async (t) => {
  const { root, post } = await fixture(t, "webhook");
  const rules = await loadRules(root);
  await saveRules(root, { malformed: true });
  const payload = { id: "retry", title: "Help", body: "Question" };
  assert.equal((await post(payload)).status, 400);
  assert.equal((await listItems(root)).length, 0);
  await saveRules(root, rules);
  assert.equal((await post(payload)).status, 202);
  assert.equal((await listItems(root)).length, 1);
});

test("receipt identity survives restart and repairs interrupted index writes without rewriting raw evidence", async (t) => {
  const { root, post, source, receiver } = await fixture(t, "webhook");
  const payload = { id: "restart", body: "Evidence", title: "Help" };
  const first = await post(payload);
  const { item_id } = await first.json();
  const original = await loadItem(root, item_id);
  const raw = join(root, original.raw_payload_path);
  const evidence = await readFile(raw, "utf8");
  await writeFile(join(root, "index", "items.json"), "[]");
  await new Promise((resolve) => receiver.server.close(resolve));
  const restarted = await startWebhookServer(root, source, { port: 0 });
  t.after(() => new Promise((resolve) => restarted.server.close(resolve)));
  const response = await fetch(restarted.url, { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ title: payload.title, body: payload.body, id: payload.id }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).item_id, item_id);
  assert.deepEqual(await loadItem(root, item_id), original);
  assert.equal((await listItemIndex(root)).length, 1);
  assert.equal(await readFile(raw, "utf8"), evidence);
  assert.equal((await readLogPage(join(root, "logs", "classify.jsonl"))).length, 1);
  const other = await startWebhookServer(root, { ...source, id: "other" }, { port: 0 });
  t.after(() => new Promise((resolve) => other.server.close(resolve)));
  const isolated = await fetch(other.url, { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify(payload) });
  assert.equal(isolated.status, 202);
  assert.notEqual((await isolated.json()).item_id, item_id);
});

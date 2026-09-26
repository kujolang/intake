import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { validateOpenAiCompatibleBaseUrl } from "../src/ai.js";
import { withActionLock } from "../src/action-lock.js";
import { syncFileSource } from "../src/adapters/file.js";
import { syncEmailSource } from "../src/adapters/email.js";
import { createBackup, restoreBackup, verifyBackup } from "../src/backup.js";
import { startDashboard } from "../src/dashboard.js";
import { readLogPage } from "../src/logs.js";
import { makeAction, makeItem, makeLearning, makeSource } from "../src/models.js";
import { evaluatePolicy } from "../src/policy.js";
import { applyRules } from "../src/rules.js";
import { sanitizeSource } from "../src/source-config.js";
import { loadDotEnvFiles } from "../src/secrets.js";
import { initStore, listActionIndex, listItemIndex, listLearningIndex, listItems, loadAction, loadSettings, saveAction, saveItem, saveLearning, savePolicies, saveSettings, saveSources } from "../src/storage.js";
import { sha256, writeJsonAtomic } from "../src/util.js";
import { approveAction, classifyAndSave, proposeDraft, runAction } from "../src/workflow.js";

async function store(t) {
  const root = await mkdtemp(join(tmpdir(), "intake-hardening-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initStore(root);
  return root;
}

const autoPolicy = { id: "auto", allowed_actions: ["*"], blocked_actions: [], risk_ceiling: "critical", requires_human_review: false, auto_execute_allowed: true };
function policy(item = {}, overrides = {}, policies) {
  return evaluatePolicy({ item: { risk_level: "low", ...item }, actionType: "mark_resolved", policies: policies || [{ ...autoPolicy, ...overrides }], settings: { auto_actions_enabled: true } });
}

test("automatic execution respects review, confidence, risk and rule vetoes", () => {
  assert.equal(policy().auto_execute_allowed, true);
  for (const result of [
    policy({}, { requires_human_review: true }),
    policy({ risk_level: "high" }),
    policy({ status: "needs_review" }),
    policy({}, { confidence_threshold: 0.9 }),
    policy({ ai_confidence: 0.8 }, { confidence_threshold: 0.9 }),
    policy({ policy: { blocked_actions: ["auto_execute"] } }),
    policy({ policy: { blocked_actions: ["mark_resolved"] } })
  ]) assert.equal(result.auto_execute_allowed, false);
  assert.equal(policy({ ai_confidence: 0.95 }, { confidence_threshold: 0.9 }).auto_execute_allowed, true);
  assert.equal(policy({ policy: { blocked_actions: ["mark_resolved"] } }).blocked, true);
});

test("empty and nonmatching policies deny execution", () => {
  for (const policies of [[], [{ ...autoPolicy, applies_to_sources: ["other"] }]]) {
    const result = policy({ source_id: "manual" }, {}, policies);
    assert.equal(result.allowed, false);
    assert.equal(result.auto_execute_allowed, false);
  }
});

test("proposed rules are inactive and reclassification refreshes rule vetoes", () => {
  const item = makeItem({ body: "hello", policy: { blocked_actions: ["old"] } });
  const rules = [{ id: "test", status: "proposed", match_any: ["hello"], queue: "engineering", blocked_actions: ["send_response"] }];
  assert.equal(applyRules(item, rules).matches.length, 0);
  const approved = applyRules(item, [{ ...rules[0], status: "approved" }]);
  assert.deepEqual(approved.item.policy.blocked_actions, ["send_response"]);
  assert.deepEqual(applyRules(approved.item, []).item.policy.blocked_actions, []);
  assert.equal(applyRules(item, [{ ...rules[0], status: undefined }]).matches.length, 1);
});

test("AI localhost exception validates the parsed hostname", (t) => {
  const old = process.env.KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST;
  t.after(() => old === undefined ? delete process.env.KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST : process.env.KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST = old);
  process.env.KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST = "true";
  for (const url of ["http://localhost.attacker.test", "http://127.0.0.1.attacker.test", "https://", "https://host:bad", "http://localhost@evil.test"]) assert.equal(validateOpenAiCompatibleBaseUrl(url).ok, false, url);
  for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://[::1]:11434/v1"]) assert.equal(validateOpenAiCompatibleBaseUrl(url).ok, true, url);
});

test("atomic writes do not collide within one millisecond or leak temporary files", async (t) => {
  const root = await store(t);
  const path = join(root, "concurrent.json");
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, id) => writeJsonAtomic(path, { id, data: "x".repeat(2000) })));
  assert.equal(results.filter(result => result.status === "rejected").length, 0);
  assert.equal((await readdir(root)).some(name => name.includes(".tmp-")), false);
  assert.equal(typeof JSON.parse(await readFile(path, "utf8")).id, "number");
});

test("concurrent item, action and learning saves retain every index row", async (t) => {
  const root = await store(t);
  for (const [make, save, list] of [[makeItem, saveItem, listItemIndex], [makeAction, saveAction, listActionIndex], [makeLearning, saveLearning, listLearningIndex]]) {
    await Promise.all(Array.from({ length: 25 }, (_, index) => save(root, make({ id: `record-${index}`, title: "parallel", type: "mark_resolved" }))));
    assert.equal((await list(root)).length, 25);
  }
});

test("storage does not disguise a broken collection as an empty store", async (t) => {
  const root = await store(t);
  await rm(join(root, "items"), { recursive: true });
  await writeFile(join(root, "items"), "not a directory");
  await assert.rejects(() => listItems(root), { code: "ENOTDIR" });
});

test("log pages preserve Unicode, malformed lines, offsets and long records", async (t) => {
  const root = await store(t);
  const path = join(root, "logs", "audit.jsonl");
  const records = [{ id: 1, text: "日本語".repeat(30000) }, { id: 2, text: "é🙂" }, { id: 3 }];
  await writeFile(path, `${JSON.stringify(records[0])}\r\n\nmalformed\n${JSON.stringify(records[1])}\n${JSON.stringify(records[2])}`);
  assert.deepEqual(await readLogPage(path, { limit: 2 }), [records[2], records[1]]);
  assert.deepEqual(await readLogPage(path, { limit: 2, offset: 2 }), [{ parse_error: true, line: "malformed" }, records[0]]);
  assert.deepEqual(await readLogPage(path, { limit: 0 }), []);
  assert.deepEqual(await readLogPage(path, { offset: 10 }), []);
  assert.equal((await readLogPage(path, { limit: Infinity })).length, 4);
  assert.deepEqual(await readLogPage(join(root, "absent")), []);
  await assert.rejects(() => readLogPage(root));
});

test("default backup removes inline source secrets but explicit inclusion preserves them", async (t) => {
  const root = await store(t);
  const source = makeSource("slack", { id: "slack", secret_ref: "env:SLACK_SECRET", config: { signing_secret: "fixture-signature", token: "fixture-token", api_token: "fixture-api" } });
  await saveSources(root, [source]);
  assert.equal(sanitizeSource(source).config.signing_secret, "[REDACTED]");
  for (const includeSecrets of [false, true]) {
    const path = join(root, "backups", `${includeSecrets}.json.gz`);
    await createBackup(root, { output: path, includeSecrets });
    const backup = JSON.parse(gunzipSync(await readFile(path)));
    const sources = JSON.parse(Buffer.from(backup.files.find(file => file.path === "config/sources.json").content_base64, "base64"));
    assert.equal(sources[0].secret_ref, "env:SLACK_SECRET");
    assert.equal(sources[0].config.signing_secret, includeSecrets ? "fixture-signature" : undefined);
    assert.equal(sources[0].config.token, includeSecrets ? "fixture-token" : undefined);
    assert.equal((await verifyBackup(path)).ok, true);
  }
});

function archive(files) {
  return { format: "kujo-intake-backup", format_version: 1, schema_version: 1, files };
}
function entry(path, text = "hello") {
  const content = Buffer.from(text);
  return { path, content_base64: content.toString("base64"), size: content.length, sha256: sha256(content) };
}

test("malformed archives fail before force restore changes the target", async (t) => {
  const root = await store(t);
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "keep"), "original");
  const path = join(root, "bad.gz");
  const cases = [null, archive({}), archive([null]), archive([entry("../outside")]), archive([entry("bad\0path")]), archive([entry("a"), entry("a")]), archive([entry("a"), entry("a/b")])];
  for (const value of cases) {
    await writeFile(path, gzipSync(JSON.stringify(value)));
    assert.equal((await verifyBackup(path)).ok, false);
    await assert.rejects(() => restoreBackup(path, target, { force: true }), /verification failed/);
    assert.equal(await readFile(join(target, "keep"), "utf8"), "original");
  }
  // Manifest-consistent but unusable configuration must also preserve the old store.
  await writeFile(path, gzipSync(JSON.stringify(archive([entry("config/meta.json", '{"schema_version":999}')]))));
  await assert.rejects(() => restoreBackup(path, target, { force: true }), /newer/);
  assert.equal(await readFile(join(target, "keep"), "utf8"), "original");
  assert.equal((await readdir(root)).some(name => name.includes(".restore-")), false);
});

test("backup decompression enforces a caller-selected bound", async (t) => {
  const root = await store(t);
  const path = join(root, "large.gz");
  await writeFile(path, gzipSync(JSON.stringify(archive([entry("a", "x".repeat(3000))]))));
  await assert.rejects(() => verifyBackup(path, { maxBytes: 100 }), /decompressed limit/);
  assert.equal((await verifyBackup(path, { maxBytes: 10000 })).ok, true);
});

test("file sources skip symlinks rather than ingesting outside files", async (t) => {
  const root = await store(t);
  const drop = join(root, "drop");
  await mkdir(drop);
  await writeFile(join(root, "private.txt"), "do not ingest");
  await symlink(join(root, "private.txt"), join(drop, "linked.txt"));
  await writeFile(join(drop, "normal.txt"), "normal");
  const result = await syncFileSource(root, makeSource("file", { id: "drop", config: { path: drop } }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].body, "normal");
});

test("IMAP sync rejects insecure configuration before resolving secrets or connecting", async () => {
  await assert.rejects(() => syncEmailSource("unused", makeSource("email", { config: { username: "test", imap: { secure: false } } })), /insecure/);
});

test("absolute INTAKE_DIR loads its own dotenv file", async (t) => {
  const root = await store(t);
  const key = "INTAKE_HARDENING_DOTENV";
  const previous = process.env[key];
  t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  delete process.env[key];
  await writeFile(join(root, ".env"), `${key}=fixture\n`);
  loadDotEnvFiles({ cwd: join(root, "other"), intakeDir: root });
  assert.equal(process.env[key], "fixture");
});

test("concurrent action requests execute once and rejected actions remain rejected", async (t) => {
  const root = await store(t);
  await saveSources(root, [makeSource("manual", { id: "manual" })]);
  await savePolicies(root, [autoPolicy]);
  await saveSettings(root, { ...(await loadSettings(root)), auto_actions_enabled: true });
  const item = makeItem({ id: "item", body: "normal" });
  await saveItem(root, item);
  const action = makeAction({ id: "action", intake_item_id: item.id, type: "create_learning", status: "approved" });
  await saveAction(root, action);
  const results = await Promise.all(Array.from({ length: 10 }, () => runAction(root, action.id)));
  assert.equal(new Set(results.map(result => result.result.learning_id)).size, 1);
  assert.equal((await listLearningIndex(root)).length, 1);
  await saveAction(root, { ...action, id: "rejected", status: "rejected" });
  assert.equal((await runAction(root, "rejected")).status, "rejected");
});

test("action budgets serialize across distinct actions and existing locks fail closed", async (t) => {
  const root = await store(t);
  await saveSources(root, [makeSource("manual", { id: "manual" })]);
  await savePolicies(root, [{ ...autoPolicy, max_auto_actions_per_hour: 1 }]);
  await saveSettings(root, { ...(await loadSettings(root)), auto_actions_enabled: true });
  await saveItem(root, makeItem({ id: "item" }));
  for (const id of ["first", "second"]) await saveAction(root, makeAction({ id, intake_item_id: "item", type: "mark_resolved" }));
  const results = await Promise.all([runAction(root, "first"), runAction(root, "second")]);
  assert.deepEqual(results.map(result => result.status), ["executed", "blocked"]);
  await mkdir(join(root, ".action-lock"));
  await assert.rejects(() => withActionLock(root, () => assert.fail()), /locked/);
  await rm(join(root, ".action-lock"), { recursive: true });
});

test("failed outbound actions require reconciliation before retry", async (t) => {
  const root = await store(t);
  await saveSources(root, [makeSource("github", { id: "github", config: { api_token: "fixture" } })]);
  await savePolicies(root, [autoPolicy]);
  await saveItem(root, makeItem({ id: "item", source_id: "github", source_native_id: "1", metadata: { project: "owner/repo" } }));
  await saveAction(root, makeAction({ id: "action", intake_item_id: "item", type: "comment_issue", status: "approved" }));
  const previous = globalThis.fetch;
  let calls = 0;
  t.after(() => globalThis.fetch = previous);
  globalThis.fetch = async () => { calls++; throw new Error("connection lost"); };
  await assert.rejects(() => runAction(root, "action"), /connection lost/);
  assert.equal((await loadAction(root, "action")).status, "execution_uncertain");
  await assert.rejects(() => runAction(root, "action"), /reconcile/);
  assert.equal(calls, 1);
  assert.equal((await approveAction(root, "action")).status, "approved");
});

test("backup verification JSON mode preserves failure exit code", async (t) => {
  const root = await store(t);
  const path = join(root, "bad.gz");
  await writeFile(path, gzipSync(JSON.stringify(archive([entry("../escape")]))));
  const result = spawnSync(process.execPath, ["bin/intake.js", "backup", "verify", path, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test("dashboard bind errors reject startup instead of crashing the process", async (t) => {
  const root = await store(t);
  const dashboard = await startDashboard(root, { port: 0, token: "test" });
  t.after(() => new Promise(resolve => dashboard.server.close(resolve)));
  await assert.rejects(() => startDashboard(root, { port: dashboard.port, token: "test" }), { code: "EADDRINUSE" });
});


test("draft creation cannot clear a safety review gate", async (t) => {
  const root = await store(t);
  await saveSources(root, [makeSource("manual", { id: "manual" })]);
  await savePolicies(root, [autoPolicy]);
  await saveSettings(root, { ...(await loadSettings(root)), auto_actions_enabled: true });
  await saveItem(root, makeItem({ id: "item", body: "Please review https://example.test" }));
  await classifyAndSave(root, "item");
  const draft = await proposeDraft(root, "item");
  assert.equal((await runAction(root, draft.id)).status, "blocked");
  await approveAction(root, draft.id);
  assert.equal((await runAction(root, draft.id)).status, "executed");
});

test("backups round trip supported colon-bearing record IDs", async (t) => {
  const root = await store(t);
  await saveItem(root, makeItem({ id: "item:123" }));
  const path = join(root, "backups", "colon.gz");
  await createBackup(root, { output: path });
  assert.equal((await verifyBackup(path)).ok, true);
});

test("editing an approved action invalidates the approval", async (t) => {
  const root = await store(t);
  await saveItem(root, makeItem({ id: "item" }));
  await saveAction(root, makeAction({ id: "action", intake_item_id: "item", type: "draft_response", status: "approved", approved_by: "operator", body: "original" }));
  const dashboard = await startDashboard(root, { port: 0, token: "test" });
  t.after(() => new Promise(resolve => dashboard.server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${dashboard.port}/api/actions/action/update`, { method: "POST", headers: { "x-intake-token": "test", "content-type": "application/json" }, body: JSON.stringify({ body: "changed" }) });
  assert.equal(response.status, 200);
  const { action } = await response.json();
  assert.equal(action.status, "needs_review");
  assert.equal(action.approved_by, null);
});


test("new actions and learnings have distinct IDs even with identical inputs", () => {
  for (const make of [makeAction, makeLearning]) {
    const ids = Array.from({ length: 1000 }, () => make({ intake_item_id: "item", title: "same", type: "draft_response" }).id);
    assert.equal(new Set(ids).size, ids.length);
  }
});


test("action lock excludes another process", async (t) => {
  const root = await store(t);
  await withActionLock(root, async () => {
    const program = 'import {withActionLock} from "./src/action-lock.js"; await withActionLock(process.argv[1],async()=>{}).catch(error=>{console.error(error.message);process.exitCode=1;});';
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, root], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /action execution is locked/);
  });
});

test("doctor JSON mode preserves failure exit code", async (t) => {
  const root = await store(t);
  await saveSources(root, [makeSource("email", { id: "broken", config: {} })]);
  const result = spawnSync(process.execPath, ["bin/intake.js", "doctor", "--dir", root, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

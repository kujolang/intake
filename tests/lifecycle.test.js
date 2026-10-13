import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualItem } from "../src/adapters/manual.js";
import { makeAction, makeSource } from "../src/models.js";
import { applyRetention, purgeItems } from "../src/retention.js";
import {
  initStore,
  listActions,
  listItems,
  listLearnings,
  loadItem,
  logEvent,
  saveAction,
  saveItem,
  saveLearning,
  saveSources
} from "../src/storage.js";
import { makeLearning } from "../src/models.js";

async function withLifecycleStore(fn) {
  const root = await mkdtemp(join(tmpdir(), "intake-lifecycle-test-"));
  try {
    await initStore(root);
    const source = makeSource("manual", { id: "manual", name: "Manual" });
    await saveSources(root, [source]);
    return await fn(root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("retention prunes old raw files and old log lines", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, {
      title: "Old raw",
      body: "This raw payload should be pruned."
    });
    await saveItem(root, item);
    const rawPath = join(root, item.raw_payload_path);
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(rawPath, oldDate, oldDate);
    await writeFile(join(root, "logs", "audit.jsonl"), [
      JSON.stringify({ timestamp: oldDate.toISOString(), event_type: "old" }),
      JSON.stringify({ timestamp: new Date().toISOString(), event_type: "new" })
    ].join("\n") + "\n", "utf8");

    const preview = await applyRetention(root, { rawDays: 1, logsDays: 1, dryRun: true });
    assert.equal(preview.raw_deleted.length, 1);
    assert.equal(existsSync(rawPath), true);

    const result = await applyRetention(root, { rawDays: 1, logsDays: 1 });
    assert.equal(result.raw_deleted.length, 1);
    await assert.rejects(() => stat(rawPath));
    const audit = await readFile(join(root, "logs", "audit.jsonl"), "utf8");
    assert.equal(audit.includes("old"), false);
    assert.equal(audit.includes("new"), true);
  });
});

test("purge removes selected items and linked records only when forced", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, {
      title: "Done",
      body: "Resolved item.",
      queue: "resolved"
    });
    const keep = await createManualItem(root, source, {
      title: "Keep",
      body: "Still active."
    });
    await saveItem(root, { ...item, status: "resolved", queue: "resolved" });
    await saveItem(root, keep);
    const action = makeAction({ intake_item_id: item.id, type: "mark_resolved", status: "executed" });
    await saveAction(root, action);
    const learning = makeLearning({ source_item_ids: [item.id], title: "Done learning" });
    await saveLearning(root, learning);
    await logEvent(root, "audit", { event_type: "test_setup" });

    await assert.rejects(() => purgeItems(root, { status: "resolved" }), /requires --force/);
    const preview = await purgeItems(root, { status: "resolved", dryRun: true });
    assert.deepEqual(preview.items, [item.id]);
    assert.deepEqual(preview.actions, [action.id]);
    assert.deepEqual(preview.learnings, [learning.id]);
    assert.equal(await loadItem(root, item.id).then(Boolean), true);

    const result = await purgeItems(root, { status: "resolved", force: true });
    assert.deepEqual(result.items, [item.id]);
    assert.equal(await loadItem(root, item.id), null);
    assert.equal(await loadItem(root, keep.id).then(Boolean), true);
    assert.equal((await listItems(root)).length, 1);
    assert.equal((await listActions(root)).length, 0);
    assert.equal((await listLearnings(root)).length, 0);
  });
});

test("purge validates date selectors before deleting", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, {
      title: "Keep me",
      body: "Invalid dates must not match everything."
    });
    await saveItem(root, { ...item, status: "resolved" });

    await assert.rejects(
      () => purgeItems(root, { status: "resolved", before: "not-a-date", force: true }),
      /--before must be a valid date/
    );
    assert.equal((await listItems(root)).length, 1);
  });
});

test("purge removes quarantined attachment payloads with item raw payloads", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, {
      title: "Attachment",
      body: "Remove all linked payloads.",
      queue: "resolved"
    });
    const attachmentPath = join("raw", "attachments", source.id, item.id, "note.txt");
    await mkdir(join(root, "raw", "attachments", source.id, item.id), { recursive: true });
    await writeFile(join(root, attachmentPath), "attachment bytes", "utf8");
    await saveItem(root, {
      ...item,
      status: "resolved",
      queue: "resolved",
      attachments: [{ filename: "note.txt", quarantined: true, quarantine_path: attachmentPath }]
    });
    const rawPath = join(root, item.raw_payload_path);
    const attachmentFullPath = join(root, attachmentPath);
    assert.equal(existsSync(rawPath), true);
    assert.equal(existsSync(attachmentFullPath), true);

    const result = await purgeItems(root, { status: "resolved", force: true });
    assert.ok(result.raw_payloads.includes(item.raw_payload_path));
    assert.ok(result.raw_payloads.includes(attachmentPath));
    assert.equal(existsSync(rawPath), false);
    assert.equal(existsSync(attachmentFullPath), false);
  });
});

test("retention validates every option before deleting raw payloads", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, { title: "Keep", body: "Evidence" });
    const rawPath = join(root, item.raw_payload_path);
    const old = new Date("2000-01-01");
    await utimes(rawPath, old, old);
    await assert.rejects(() => applyRetention(root, { rawDays: 1, logsDays: -1 }), /log retention days/);
    assert.equal(existsSync(rawPath), true);
  });
});

test("purge validates all payload paths before deleting any linked records", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, { title: "Keep", body: "Evidence" });
    const action = makeAction({ intake_item_id: item.id, type: "mark_resolved" });
    await saveAction(root, action);
    for (const unsafe of ["../outside.txt", "config/sources.json", "raw"]) {
      await saveItem(root, { ...item, attachments: [{ quarantine_path: unsafe }] });
      await assert.rejects(() => purgeItems(root, { item: item.id, force: true }), /unsafe raw payload path/);
      assert.equal((await listActions(root)).length, 1);
      assert.ok(await loadItem(root, item.id));
      assert.equal(existsSync(join(root, item.raw_payload_path)), true);
      assert.equal(existsSync(join(root, "config", "sources.json")), true);
    }
  });
});

test("log retention preserves malformed, undated and UTF-8 lines while removing epoch timestamps", async () => {
  await withLifecycleStore(async (root) => {
    const path = join(root, "logs", "sync.jsonl");
    const kept = ["{broken\rrecord", JSON.stringify({ message: "保留🙂".repeat(20000), timestamp: null }), JSON.stringify({ timestamp: "2099-01-01", message: "future" })];
    await writeFile(path, [JSON.stringify({ timestamp: "1970-01-01T00:00:00.000Z" }), "", ...kept].join("\r\n"));
    const preview = await applyRetention(root, { logsDays: 1, dryRun: true });
    assert.deepEqual(preview.logs_compacted, [{ log: "sync", removed: 1, kept: 3 }]);
    const result = await applyRetention(root, { logsDays: 1 });
    assert.deepEqual(result.logs_compacted, preview.logs_compacted);
    assert.equal(await readFile(path, "utf8"), kept.join("\n") + "\n");
  });
});

test("retention preserves untouched bytes and file permissions and cleans failed writes", async () => {
  await withLifecycleStore(async (root) => {
    const path = join(root, "logs", "sync.jsonl");
    const content = '\r\n{"timestamp":"2099-01-01"}\r\n{broken';
    await writeFile(path, content);
    await chmod(path, 0o600);
    await applyRetention(root, { logsDays: 1 });
    assert.equal(await readFile(path, "utf8"), content);
    await writeFile(path, '{"timestamp":"2000-01-01"}\n' + content);
    await applyRetention(root, { logsDays: 1 });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await rm(path);
    await mkdir(path);
    await assert.rejects(() => applyRetention(root, { logsDays: 1 }));
    assert.equal((await stat(path)).isDirectory(), true);
    assert.equal((await readdir(join(root, "logs"))).some((name) => name.includes(".tmp-")), false);
  });
});

test("purge rejects symlink payload directories before removing item state", async () => {
  await withLifecycleStore(async (root, source) => {
    const item = await createManualItem(root, source, { title: "Keep", body: "Evidence" });
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await symlink(outside, join(root, "raw", "linked"));
    await saveItem(root, { ...item, raw_payload_path: "raw/linked/keep.txt" });
    await assert.rejects(() => purgeItems(root, { item: item.id, force: true }), /unsafe raw payload path/);
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
    assert.ok(await loadItem(root, item.id));
  });
});

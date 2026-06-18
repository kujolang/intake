import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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

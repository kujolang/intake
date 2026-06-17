import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSource } from "../src/models.js";
import { initStore, listItemIndex, loadSources, saveSources } from "../src/storage.js";
import { syncAll } from "../src/workflow.js";

test("generated large source sync remains deduped on repeated runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-large-sync-test-"));
  const drop = join(root, "drop");
  try {
    await initStore(root);
    await mkdir(drop, { recursive: true });
    for (let index = 0; index < 250; index += 1) {
      await writeFile(join(drop, `mail-${index}.json`), JSON.stringify({
        id: `message-${index}`,
        source_type: "email",
        title: `Generated mailbox item ${index}`,
        body: index % 10 === 0 ? "Please refund this invoice." : "How do I configure this account?",
        author_email: `customer-${index}@example.test`,
        tags: ["generated-mailbox"]
      }), "utf8");
    }
    const source = makeSource("file", {
      id: "generated-mailbox",
      name: "Generated Mailbox",
      config: { path: drop },
      default_queue: "support"
    });
    await saveSources(root, [source]);
    const first = await syncAll(root, "generated-mailbox");
    const second = await syncAll(root, "generated-mailbox");
    const rows = await listItemIndex(root, { source_id: "generated-mailbox", limit: 300 });
    const [savedSource] = await loadSources(root);
    assert.equal(first[0].saved.length, 250);
    assert.equal(second[0].saved.length, 0);
    assert.equal(rows.length, 250);
    assert.equal(savedSource.last_sync_result.saved_count, 0);
    assert.ok(savedSource.cursor.seen.length >= 250);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

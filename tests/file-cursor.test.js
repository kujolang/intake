import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncFileSource } from "../src/adapters/file.js";
import { initStore } from "../src/storage.js";
import { withStoreLock } from "../src/store-lock.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "intake-cursor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initStore(root);
  const folder = join(root, "drop");
  await mkdir(folder);
  return { root, folder };
}

test("malformed file bytes count against the ingestion batch budget", async (t) => {
  const { root, folder } = await fixture(t);
  await writeFile(join(folder, "a.json"), "invalid!");
  await writeFile(join(folder, "b.txt"), "accepted");
  const source = { id: "files", config: { path: folder, max_batch_bytes: 10 } };
  const first = await syncFileSource(root, source);
  assert.equal(first.items.length, 0);
  const second = await syncFileSource(root, { ...source, cursor: first.cursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].metadata.file_name, "b.txt");
  assert.equal(first.cursor.seen.length, 0);
});

test("file batches eventually reach new files beyond the bounded seen cache", async (t) => {
  const { root, folder } = await fixture(t);
  const keys = [];
  for (let start = 0; start <= 6000; start += 64) {
    const batch = Array.from({ length: Math.min(64, 6001 - start) }, (_, i) => start + i);
    keys.push(...await Promise.all(batch.map(async (i) => {
      const name = `${String(i).padStart(4, "0")}.txt`;
      const path = join(folder, name);
      await writeFile(path, "");
      const info = await lstat(path);
      return `${name}:${info.mtimeMs}:${info.size}`;
    })));
  }
  // A legacy cursor after ingesting 6,000 files retains only the last 5,000.
  let source = { id: "files", config: { path: folder, max_batch_items: 1000 }, cursor: { seen: keys.slice(1000, 6000) } };
  let found = false;
  for (let batch = 0; batch < 7; batch++) {
    const result = await withStoreLock(root, () => syncFileSource(root, source));
    assert.ok(result.cursor.seen.length <= 5000);
    assert.ok(result.items.length <= 1000);
    source = { ...source, cursor: result.cursor };
    if (result.items.some((item) => item.metadata.file_name === "6000.txt")) { found = true; break; }
  }
  assert.equal(found, true, "earlier evicted files must not permanently starve the new file");
});

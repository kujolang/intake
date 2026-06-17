#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualItem } from "../src/adapters/manual.js";
import { makeSource } from "../src/models.js";
import { initStore, listItemIndex, logEvent, saveItem, saveSources } from "../src/storage.js";
import { syncAll } from "../src/workflow.js";

const flags = parseArgs(process.argv.slice(2));
const items = Number(flags.items || 1000);
const logs = Number(flags.logs || 100000);
const fileRows = Number(flags.fileRows || 1000);
const root = flags.dir || await mkdtemp(join(tmpdir(), "intake-bench-"));
const cleanup = !flags.dir;

try {
  await initStore(root);
  const manual = makeSource("manual", { id: "manual", name: "Manual" });
  await saveSources(root, [manual]);

  const insertItems = await measure(`insert_${items}_items`, async () => {
    for (let index = 0; index < items; index += 1) {
      const item = await createManualItem(root, manual, {
        title: `Benchmark item ${index}`,
        body: index % 5 === 0 ? "How do I fix this bug?" : "General customer question.",
        queue: index % 3 === 0 ? "support" : "inbox"
      });
      await saveItem(root, item, { rebuildIndex: false });
    }
  });

  const indexRead = await measure("read_index_page_100", async () => {
    await listItemIndex(root, { limit: 100, offset: Math.floor(items / 2) });
  });

  const writeLogs = await measure(`write_${logs}_audit_logs`, async () => {
    for (let index = 0; index < logs; index += 1) {
      await logEvent(root, "audit", { event_type: "bench_log", item_id: `bench-${index}` });
    }
  });

  const drop = join(root, "drop");
  await mkdir(drop, { recursive: true });
  for (let index = 0; index < fileRows; index += 1) {
    await writeFile(join(drop, `row-${index}.json`), JSON.stringify({ id: `same-${Math.floor(index / 2)}`, title: `File ${index}`, body: "Repeated sync dedupe fixture" }), "utf8");
  }
  const file = makeSource("file", { id: "file-drop", name: "File Drop", config: { path: drop } });
  await saveSources(root, [manual, file]);
  const firstSync = await measure(`sync_${fileRows}_file_rows`, async () => syncAll(root, "file-drop"));
  const secondSync = await measure("sync_repeated_dedupe", async () => syncAll(root, "file-drop"));

  console.log(JSON.stringify({ root, items, logs, fileRows, timings_ms: [insertItems, indexRead, writeLogs, firstSync, secondSync] }, null, 2));
} finally {
  if (cleanup) await rm(root, { recursive: true, force: true });
}

async function measure(name, fn) {
  const start = performance.now();
  await fn();
  return { name, ms: Math.round(performance.now() - start) };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    out[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return out;
}

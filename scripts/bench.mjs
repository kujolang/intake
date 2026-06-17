#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualItem } from "../src/adapters/manual.js";
import { startDashboard } from "../src/dashboard.js";
import { makeAction, makeLearning, makeSource } from "../src/models.js";
import { initStore, listItemIndex, logEvent, rebuildActionIndex, rebuildLearningIndex, saveAction, saveItem, saveLearning, saveSources } from "../src/storage.js";
import { syncAll } from "../src/workflow.js";
import { isoNow } from "../src/util.js";

const flags = parseArgs(process.argv.slice(2));
const items = Number(flags.items || 1000);
const logs = Number(flags.logs || 100000);
const fileRows = Number(flags.fileRows || 1000);
const actions = Number(flags.actions ?? 1000);
const learnings = Number(flags.learnings ?? 1000);
const dashboardEnabled = flags.dashboard !== "false";
const root = flags.dir || await mkdtemp(join(tmpdir(), "intake-bench-"));
const cleanup = !flags.dir;

try {
  await initStore(root);
  const manual = makeSource("manual", { id: "manual", name: "Manual" });
  await saveSources(root, [manual]);
  const itemIds = [];

  const insertItems = await measure(`insert_${items}_items`, async () => {
    for (let index = 0; index < items; index += 1) {
      const item = await createManualItem(root, manual, {
        title: `Benchmark item ${index}`,
        body: index % 5 === 0 ? "How do I fix this bug?" : "General customer question.",
        queue: index % 3 === 0 ? "support" : "inbox"
      });
      await saveItem(root, item, { rebuildIndex: false });
      itemIds.push(item.id);
    }
  });

  const indexRead = await measure("read_index_page_100", async () => {
    await listItemIndex(root, { limit: 100, offset: Math.floor(items / 2) });
  });

  const insertActions = await measure(`insert_${actions}_actions`, async () => {
    for (let index = 0; index < actions; index += 1) {
      await saveAction(root, makeAction({
        intake_item_id: itemIds[index % Math.max(1, itemIds.length)] || `bench-item-${index}`,
        source_id: "manual",
        type: index % 4 === 0 ? "mark_resolved" : "draft_response",
        status: index % 3 === 0 ? "approved" : "proposed",
        approved_by: index % 3 === 0 ? "benchmark" : null,
        approved_at: index % 3 === 0 ? isoNow() : null,
        body: "Benchmark action body"
      }), { rebuildIndex: false });
    }
    await rebuildActionIndex(root);
  });

  const insertLearnings = await measure(`insert_${learnings}_learnings`, async () => {
    for (let index = 0; index < learnings; index += 1) {
      await saveLearning(root, makeLearning({
        source_item_ids: [itemIds[index % Math.max(1, itemIds.length)] || `bench-item-${index}`],
        source_id: "manual",
        title: `Benchmark learning ${index}`,
        summary: "Benchmark learning summary",
        status: index % 2 === 0 ? "approved" : "proposed",
        confidence: 0.8
      }), { rebuildIndex: false });
    }
    await rebuildLearningIndex(root);
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
  const dashboardTimings = dashboardEnabled ? await measureDashboard(root) : [];

  console.log(JSON.stringify({ root, items, logs, fileRows, actions, learnings, timings_ms: [insertItems, indexRead, insertActions, insertLearnings, writeLogs, firstSync, secondSync, ...dashboardTimings] }, null, 2));
} finally {
  if (cleanup) await rm(root, { recursive: true, force: true });
}

async function measure(name, fn) {
  const start = performance.now();
  await fn();
  return { name, ms: Math.round(performance.now() - start) };
}

async function measureDashboard(root) {
  const dashboard = await startDashboard(root, { port: 0, token: "bench-token" });
  const base = `http://${dashboard.host}:${dashboard.port}`;
  const headers = { "x-intake-token": "bench-token" };
  try {
    await fetchJson(`${base}/api/summary`, headers);
    await fetchJson(`${base}/api/items?limit=100`, headers);
    await fetchJson(`${base}/api/actions?limit=100`, headers);
    await fetchJson(`${base}/api/learnings?limit=100`, headers);
    await fetchJson(`${base}/api/approval-audit`, headers);
    return [
      await measure("dashboard_summary_warm", async () => fetchJson(`${base}/api/summary`, headers)),
      await measure("dashboard_items_page_100_warm", async () => fetchJson(`${base}/api/items?limit=100`, headers)),
      await measure("dashboard_actions_page_100_warm", async () => fetchJson(`${base}/api/actions?limit=100`, headers)),
      await measure("dashboard_learnings_page_100_warm", async () => fetchJson(`${base}/api/learnings?limit=100`, headers)),
      await measure("dashboard_approval_audit_warm", async () => fetchJson(`${base}/api/approval-audit`, headers))
    ];
  } finally {
    await new Promise((resolve) => dashboard.server.close(resolve));
  }
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return response.json();
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

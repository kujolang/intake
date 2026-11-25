import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startDashboard } from "../src/dashboard.js";
import { makeAction, makeItem, makeLearning } from "../src/models.js";
import { initStore, rebuildActionIndex, rebuildItemIndex, rebuildLearningIndex } from "../src/storage.js";
import { sha256 } from "../src/util.js";

const root = await mkdtemp(join(tmpdir(), "intake-bench-dashboard-"));
const records = 3000;
const samples = 12;
const body = "Synthetic inbox message for a dashboard read benchmark. ".repeat(80);
const servers = [];
const seed = (collection, record) => writeFile(join(root, collection, record.id + ".json"), JSON.stringify(record));
try {
  await initStore(root);
  for (let index = 0; index < records; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    const itemId = `item-${index}`;
    await seed("items", makeItem({
      id: itemId, source_id: index % 2 ? "manual" : "email", title: `Inbox item ${index}`, body,
      received_at: timestamp, created_at: timestamp, updated_at: timestamp,
      risk_level: index % 10 === 0 ? "high" : "low"
    }));
    await seed("actions", makeAction({
      id: `action-${index}`, intake_item_id: itemId, type: "draft_response", body,
      status: index % 2 ? "approved" : "proposed",
      approved_by: index % 2 ? (index % 100 === 1 ? "rare-reviewer" : "operator") : null,
      approved_at: index % 2 ? timestamp : null, created_at: timestamp
    }));
    if (index < 100) await seed("learnings", makeLearning({
      id: `learning-${index}`, source_item_ids: [itemId], title: `Learning ${index}`, created_at: timestamp
    }));
  }
  await rebuildItemIndex(root);
  await rebuildActionIndex(root);
  await rebuildLearningIndex(root);
  const baselineDir = process.argv[2];
  if (baselineDir) {
    const baseline = await import(pathToFileURL(resolve(baselineDir, "src/dashboard.js")).href);
    servers.push(["baseline", await baseline.startDashboard(root, { port: 0 })]);
  }
  servers.push(["current", await startDashboard(root, { port: 0 })]);
  const timings = {};
  for (const [path, field, count] of [
    ["items?view=inbox&risk=high&limit=20&offset=20", "items", 20],
    ["actions?status=approved&limit=100", "actions", 100],
    ["learnings?limit=100", "learnings", 100],
    ["approval-audit", "rows", 1500],
    ["approval-audit?operator=rare-reviewer&format=csv", "rows", 30]
  ]) {
    const fetchPage = async (dashboard) => {
      const base = new URL(dashboard.url).origin;
      const response = await fetch(`${base}/api/${path}`, { headers: { "x-intake-token": dashboard.token } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const durations = Object.fromEntries(servers.map(([name]) => [name, []]));
    let hash;
    for (const [, dashboard] of servers) {
      const warm = await fetchPage(dashboard);
      assert.equal(warm[field].length, count);
      const warmHash = sha256(JSON.stringify(warm));
      hash ??= warmHash;
      assert.equal(warmHash, hash);
    }
    for (let sample = 0; sample < samples; sample += 1) {
      const order = sample % 2 === 0 ? servers : [...servers].reverse();
      for (const [name, dashboard] of order) {
        const start = performance.now();
        const page = await fetchPage(dashboard);
        durations[name].push(performance.now() - start);
        assert.equal(sha256(JSON.stringify(page)), hash);
      }
    }
    timings[path] = { records: count, hash };
    for (const [name, times] of Object.entries(durations)) {
      times.sort((a, b) => a - b);
      const middle = times.length / 2;
      const median = (times[middle - 1] + times[middle]) / 2;
      timings[path][name] = {
        median_ms: Number(median.toFixed(1)),
        min_ms: Number(times[0].toFixed(1)),
        max_ms: Number(times.at(-1).toFixed(1))
      };
    }
  }
  console.log(JSON.stringify({ node: process.version, fixture_items_and_actions: records, samples, timings }, null, 2));
} finally {
  await Promise.all(servers.map(([, dashboard]) => new Promise((done) => dashboard.server.close(done))));
  await rm(root, { recursive: true, force: true });
}

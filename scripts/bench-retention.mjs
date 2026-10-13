import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyRetention } from "../src/retention.js";
import { initStore } from "../src/storage.js";
import { sha256 } from "../src/util.js";

// Separate fixture generation from the measured process's peak RSS.
if (process.argv[2] === "--worker") {
  const start = performance.now();
  const result = await applyRetention(process.argv[3], { logsDays: 1 });
  const elapsed = performance.now() - start;
  const peakRss = process.resourceUsage().maxRSS;
  const output = await readFile(join(process.argv[3], "logs", "sync.jsonl"));
  console.log(JSON.stringify({ elapsed_ms: Math.round(elapsed), peak_rss_kib: peakRss, output_bytes: output.length, output_sha256: sha256(output), compacted: result.logs_compacted }));
} else {
  const root = await mkdtemp(join(tmpdir(), "intake-retention-bench-"));
  try {
    await initStore(root);
    const old = JSON.stringify({ timestamp: "2000-01-01T00:00:00.000Z", event_type: "old", message: "x".repeat(400) }) + "\n";
    const kept = JSON.stringify({ timestamp: "2099-01-01T00:00:00.000Z", event_type: "keep", message: "x".repeat(400) }) + "\n";
    const block = (old + kept).repeat(500);
    const file = await open(join(root, "logs", "sync.jsonl"), "w");
    try {
      for (let i = 0; i < 200; i++) await file.writeFile(block);
    } finally { await file.close(); }
    const heapArgs = process.argv.includes("--bounded-heap") ? ["--max-old-space-size=64"] : [];
    const worker = spawnSync(process.execPath, [...heapArgs, fileURLToPath(import.meta.url), "--worker", root], { encoding: "utf8" });
    if (worker.status !== 0) throw new Error(worker.stderr || `worker failed: ${worker.status}`);
    const result = JSON.parse(worker.stdout);
    assert.deepEqual(result.compacted, [{ log: "sync", removed: 100000, kept: 100000 }]);
    assert.equal(result.output_sha256, sha256(kept.repeat(100000)));
    console.log(JSON.stringify({ node: process.version, rows: 200000, input_bytes: Buffer.byteLength(block) * 200, ...result }, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}

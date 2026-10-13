import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initStore } from "../src/storage.js";
import { runDoctor } from "../src/doctor.js";

if (process.argv[2] === "--worker") {
  const start = performance.now();
  const result = await runDoctor(process.argv[3]);
  console.log(JSON.stringify({ elapsed_ms: Math.round(performance.now() - start), peak_rss_kib: process.resourceUsage().maxRSS, log_check: result.checks.find((check) => check.id === "logs:redaction") }));
} else if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await benchmarkDoctor({ boundedHeap: process.argv.includes("--bounded-heap") }), null, 2));
}

export async function benchmarkDoctor({ boundedHeap = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "intake-doctor-bench-"));
  try {
    await initStore(root);
    const block = `${"x".repeat(65535)}\n`;
    const file = await open(join(root, "logs", "audit.jsonl"), "w");
    try { for (let i = 0; i < 1024; i++) await file.writeFile(block); }
    finally { await file.close(); }
    const worker = spawnSync(process.execPath, [...(boundedHeap ? ["--max-old-space-size=48"] : []), fileURLToPath(import.meta.url), "--worker", root], { encoding: "utf8", timeout: 30000 });
    assert.equal(worker.status, 0, worker.stderr);
    const result = JSON.parse(worker.stdout);
    assert.equal(result.log_check.status, "ok");
    return { node: process.version, input_bytes: 64 * 1024 * 1024, ...result };
  } finally { await rm(root, { recursive: true, force: true }); }
}

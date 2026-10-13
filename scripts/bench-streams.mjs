import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readBounded } from "../src/resource-limits.js";
import { readStreamText, sha256 } from "../src/util.js";

const bytes = 1024 * 1024;
if (process.argv[2] === "--worker") {
  const reader = process.argv[3];
  function* chunks() {
    const byte = Buffer.from("x");
    for (let i = 0; i < bytes; i++) { yield Buffer.alloc(0); yield byte; }
  }
  const start = performance.now();
  const output = reader === "text"
    ? await readStreamText(chunks(), { maxBytes: bytes })
    : await readBounded(chunks(), bytes, "fixture");
  console.log(JSON.stringify({ reader, bytes: output.length, sha256: sha256(output), elapsed_ms: Math.round(performance.now() - start), peak_rss_kib: process.resourceUsage().maxRSS }));
} else {
  const samples = [];
  for (const reader of ["bytes", "text"]) {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", reader], { encoding: "utf8" });
    if (worker.status !== 0) throw new Error(worker.stderr || `worker failed: ${worker.status}`);
    const sample = JSON.parse(worker.stdout);
    assert.equal(sample.bytes, bytes);
    assert.equal(sample.sha256, sha256(Buffer.alloc(bytes, 120)));
    samples.push(sample);
  }
  console.log(JSON.stringify({ node: process.version, chunk_count: bytes * 2, samples }, null, 2));
}

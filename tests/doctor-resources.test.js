import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkDoctor } from "../scripts/bench-doctor.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initStore } from "../src/storage.js";
import { runDoctor } from "../src/doctor.js";

test("doctor preserves audit warnings across stream chunk boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "intake-doctor-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initStore(root);
  const path = join(root, "logs", "audit.jsonl");
  for (const [text, status] of [
    ["x".repeat(65533) + "password", "warn"],
    ["token" + "x".repeat(65528) + "[REDACTED]", "ok"],
    ["x".repeat(65535) + "é token", "warn"]
  ]) {
    await writeFile(path, text);
    const result = await runDoctor(root);
    assert.equal(result.checks.find((check) => check.id === "logs:redaction").status, status);
  }
  await rm(path);
  const failed = await runDoctor(root);
  assert.equal(failed.checks.find((check) => check.id === "logs:audit").status, "fail");
});

test("doctor scans a 64 MiB audit log within a 48 MiB heap", async () => {
  const receipt = await benchmarkDoctor({ boundedHeap: true });
  assert.equal(receipt.input_bytes, 64 * 1024 * 1024);
  assert.equal(receipt.log_check.status, "ok");
});

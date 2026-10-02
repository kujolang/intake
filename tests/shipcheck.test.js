import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initStore } from "../src/storage.js";
import { runShipcheck } from "../src/shipcheck.js";

test("shipcheck reports local release health and external enterprise blockers", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-shipcheck-test-"));
  try {
    await initStore(root);
    const report = await runShipcheck(root);
    assert.equal(report.ok, true);
    assert.equal(report.enterprise_ready, false);
    assert.ok(report.checks.some((check) => check.id === "release-scripts" && check.status === "ok"));
    assert.ok(report.checks.some((check) => check.id === "ci-workflow" && check.status === "ok"));
    assert.ok(report.checks.some((check) => check.id === "root-files" && check.status === "ok"));
    assert.ok(report.checks.some((check) => check.id === "package-private" && check.status === "warn"));
    assert.ok(report.blockers.some((blocker) => /Live PrivateEmail/.test(blocker)));
    assert.ok(report.blockers.some((blocker) => /Remote GitHub Actions evidence/.test(blocker)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shipcheck fails local release health when package metadata is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-shipcheck-missing-test-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "intake-empty-project-"));
  try {
    await initStore(root);
    const report = await runShipcheck(root, { projectRoot });
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.id === "package-metadata" && check.status === "fail"));
    assert.ok(report.checks.some((check) => check.id === "ci-workflow" && check.status === "fail"));
    assert.ok(report.checks.some((check) => check.id === "root-files" && check.status === "fail"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("benchmark threshold gate rejects invalid threshold overrides", () => {
  const result = spawnSync(process.execPath, ["scripts/bench-threshold.mjs", "--dashboardSummaryMs", "NaN"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /dashboardSummaryMs must be a positive number/);
});

test("package gate excludes transient audit logs", () => {
  const result = spawnSync(process.execPath, ["scripts/check-package.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.files > 0);
  assert.ok(receipt.unpacked_size > 0);
});

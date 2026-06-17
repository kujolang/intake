import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/doctor.js";
import { makeSource } from "../src/models.js";
import { initStore, saveSources } from "../src/storage.js";

test("doctor warns for disabled broken sources and fails enabled missing secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-doctor-test-"));
  try {
    await initStore(root);
    delete process.env.INTAKE_MISSING_ENABLED_PASSWORD;
    await saveSources(root, [
      makeSource("email", {
        id: "disabled-email",
        enabled: false,
        config: {},
        secret_ref: null
      }),
      makeSource("email", {
        id: "enabled-email",
        enabled: true,
        config: { username: "support@example.com" },
        secret_ref: "env:INTAKE_MISSING_ENABLED_PASSWORD"
      })
    ]);

    const result = await runDoctor(root);

    assert.equal(result.ok, false);
    assert.equal(result.failed, 1);
    assert.ok(result.warnings >= 2);
    assert.equal(result.checks.find((check) => check.id === "source:disabled-email").status, "warn");
    assert.equal(result.checks.find((check) => check.id === "secret:disabled-email").status, "warn");
    assert.equal(result.checks.find((check) => check.id === "secret:enabled-email").status, "fail");
  } finally {
    delete process.env.INTAKE_MISSING_ENABLED_PASSWORD;
    await rm(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnvFile, resolveSecretRef } from "../src/secrets.js";
import { buildSourceFromInput } from "../src/source-config.js";

test("loads local .env values without overwriting existing env", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-secrets-test-"));
  const path = join(root, ".env");
  try {
    delete process.env.INTAKE_TEST_SECRET;
    process.env.INTAKE_EXISTING_SECRET = "keep";
    await writeFile(path, "INTAKE_TEST_SECRET=\"from-env-file\"\nINTAKE_EXISTING_SECRET=replace\n", "utf8");
    loadDotEnvFile(path);
    assert.equal(process.env.INTAKE_TEST_SECRET, "from-env-file");
    assert.equal(process.env.INTAKE_EXISTING_SECRET, "keep");
    assert.equal(resolveSecretRef("env:INTAKE_TEST_SECRET", "test"), "from-env-file");
  } finally {
    delete process.env.INTAKE_TEST_SECRET;
    delete process.env.INTAKE_EXISTING_SECRET;
    await rm(root, { recursive: true, force: true });
  }
});

test("source config rejects unsupported secret refs", () => {
  assert.throws(() => buildSourceFromInput({
    type: "email",
    id: "bad-secret",
    username: "support@example.com",
    secret_ref: "plain:password"
  }), /unsupported secret_ref/);
});

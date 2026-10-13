import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { initStore } from "../src/storage.js";
import { migrationStatus, runMigrations } from "../src/migrations.js";
import { runDoctor } from "../src/doctor.js";
import { createBackup, restoreBackup } from "../src/backup.js";
import { sha256 } from "../src/util.js";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-metadata-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  return { base, root, meta: join(root, "config", "meta.json") };
}

test("initialization rejects malformed metadata without rewriting evidence", async (t) => {
  const { root, meta } = await fixture(t);
  for (const value of [{ schema_version: "invalid" }, [], false, 1, "text", null,
    { schema_version: null }, { schema_version: true }, { schema_version: [] },
    { schema_version: -1 }, { schema_version: 0.5 }, { schema_version: "" },
    { schema_version: 999 }]) {
    const bytes = JSON.stringify(value);
    await writeFile(meta, bytes);
    await assert.rejects(() => initStore(root), /metadata|schema/i);
    assert.equal(await readFile(meta, "utf8"), bytes);
  }
});

test("migration keeps legacy objects and numeric schema strings compatible", async (t) => {
  const { root, meta } = await fixture(t);
  for (const value of [{ custom: "legacy" }, { schema_version: 0 }, { schema_version: "1" }]) {
    await writeFile(meta, JSON.stringify(value));
    await runMigrations(root);
    const saved = JSON.parse(await readFile(meta, "utf8"));
    assert.equal(saved.schema_version, 1);
    if (value.custom) assert.equal(saved.custom, value.custom);
  }
  await rm(meta);
  await initStore(root);
  assert.equal((await migrationStatus(root)).ok, true);
});

test("doctor reports corrupt or missing metadata instead of throwing or claiming a default schema", async (t) => {
  const { root, meta } = await fixture(t);
  for (const bytes of ["null", "{", '{"schema_version":false}']) {
    await writeFile(meta, bytes);
    const status = await migrationStatus(root);
    assert.equal(status.ok, false);
    const report = await runDoctor(root);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "storage:schema").status, "fail");
    assert.equal(await readFile(meta, "utf8"), bytes);
  }
  await rm(meta);
  assert.equal((await runDoctor(root)).checks.find((check) => check.id === "storage:schema").status, "fail");
});

test("forced restore rejects malformed archived metadata before replacing the destination", async (t) => {
  const { root, base, meta } = await fixture(t);
  const archive = join(base, "backup.json.gz");
  await createBackup(root, { output: archive });
  const payload = JSON.parse(gunzipSync(await readFile(archive)));
  const record = payload.files.find((file) => file.path === "config/meta.json");
  const bytes = Buffer.from('{"schema_version":"invalid"}');
  Object.assign(record, { content_base64: bytes.toString("base64"), size: bytes.length, sha256: sha256(bytes) });
  await writeFile(archive, gzipSync(JSON.stringify(payload)));
  const before = await readFile(meta, "utf8");
  await assert.rejects(() => restoreBackup(archive, root, { force: true }), /metadata|schema/i);
  assert.equal(await readFile(meta, "utf8"), before);
  assert.equal((await migrationStatus(root)).ok, true);
});

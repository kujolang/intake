import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE_SCHEMA_VERSION, VERSION } from "./constants.js";
import { isoNow, readJson, writeJsonAtomic } from "./util.js";

const MIGRATIONS = [];

export async function runMigrations(root) {
  const metaPath = join(root, "config", "meta.json");
  const meta = await readJson(metaPath, defaultMigrationMeta());
  const from = schemaVersion(meta);
  if (from > STORAGE_SCHEMA_VERSION) {
    throw new Error(`store schema ${from} is newer than this Intake version supports (${STORAGE_SCHEMA_VERSION})`);
  }
  let current = from;
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      await migration.up(root);
      current = migration.version;
    }
  }
  const next = {
    ...meta,
    schema_version: STORAGE_SCHEMA_VERSION,
    app_version: VERSION,
    migrated_at: current !== from ? isoNow() : meta.migrated_at || null,
    updated_at: isoNow()
  };
  await writeJsonAtomic(metaPath, next);
  return { from, to: STORAGE_SCHEMA_VERSION, migrated: current !== from };
}

// Missing metadata is distinct from corrupt persisted content. Keep diagnostics
// read-only so inspection cannot erase the evidence that initialization rejects.
export async function migrationStatus(root) {
  let version;
  try {
    const meta = JSON.parse(await readFile(join(root, "config", "meta.json"), "utf8"));
    version = schemaVersion(meta);
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, schema_version: null, expected: STORAGE_SCHEMA_VERSION, message: "missing storage metadata" };
    if (!(error instanceof SyntaxError) && error.code !== "INTAKE_INVALID_METADATA") throw error;
    return { ok: false, schema_version: null, expected: STORAGE_SCHEMA_VERSION, message: "invalid storage metadata; inspect config/meta.json before recovery" };
  }
  return {
    ok: version === STORAGE_SCHEMA_VERSION,
    schema_version: version,
    expected: STORAGE_SCHEMA_VERSION,
    message: version === STORAGE_SCHEMA_VERSION ? `schema ${version}` : `schema ${version} expected ${STORAGE_SCHEMA_VERSION}`
  };
}

function schemaVersion(meta) {
  const invalid = () => Object.assign(new Error("invalid storage metadata; schema_version must be a nonnegative safe integer"), { code: "INTAKE_INVALID_METADATA" });
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw invalid();
  // Pre-versioned object metadata and numeric-string versions remain readable.
  const value = meta.schema_version === undefined ? 0 : meta.schema_version;
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) throw invalid();
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) throw invalid();
  return version;
}

function defaultMigrationMeta() {
  const now = isoNow();
  return {
    schema_version: STORAGE_SCHEMA_VERSION,
    app_version: VERSION,
    created_at: now,
    updated_at: now
  };
}

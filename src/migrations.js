import { stat } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE_SCHEMA_VERSION, VERSION } from "./constants.js";
import { isoNow, readJson, writeJsonAtomic } from "./util.js";

const MIGRATIONS = [];

export async function runMigrations(root) {
  const metaPath = join(root, "config", "meta.json");
  const meta = await readJson(metaPath, defaultMigrationMeta());
  const from = Number(meta.schema_version || 0);
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

export async function migrationStatus(root) {
  const metaPath = join(root, "config", "meta.json");
  try {
    await stat(metaPath);
  } catch {
    return { ok: false, schema_version: null, expected: STORAGE_SCHEMA_VERSION, message: "missing storage metadata" };
  }
  const meta = await readJson(metaPath, null);
  const schemaVersion = Number(meta?.schema_version || 0);
  return {
    ok: schemaVersion === STORAGE_SCHEMA_VERSION,
    schema_version: schemaVersion,
    expected: STORAGE_SCHEMA_VERSION,
    message: schemaVersion === STORAGE_SCHEMA_VERSION ? `schema ${schemaVersion}` : `schema ${schemaVersion || "unknown"} expected ${STORAGE_SCHEMA_VERSION}`
  };
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

import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertSafeId, readJson, writeJsonAtomic } from "./util.js";

const SECTIONS = ["sources", "policies", "rules", "settings"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export function configImportJournalPath(root) { return `${root}.intake-config-import.json`; }

export function validateConfigImport(payload) {
  if (!object(payload) || payload.version !== 1) throw new Error("unsupported config export");
  for (const section of ["sources", "policies", "rules"]) {
    if (!Array.isArray(payload[section])) throw new Error(`config import requires a ${section} array`);
    const ids = new Set();
    for (const entry of payload[section]) {
      if (!object(entry) || !((typeof entry.id === "string" && entry.id) || (typeof entry.id === "number" && Number.isFinite(entry.id)))) throw new Error(`config ${section} entries require an id`);
      if (ids.has(String(entry.id))) throw new Error(`duplicate config ${section} id: ${entry.id}`);
      ids.add(String(entry.id));
    }
  }
  if (!object(payload.settings)) throw new Error("config import requires a settings object");
  for (const key of ["auto_actions_enabled", "ai_enabled"]) {
    if (payload.settings[key] !== undefined && typeof payload.settings[key] !== "boolean") throw new Error(`settings ${key} must be boolean`);
  }
  for (const source of payload.sources) {
    assertSafeId(source.id, "source id");
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") throw new Error(`source ${source.id} enabled must be boolean`);
    if (typeof source.type !== "string" || !source.type) throw new Error(`source ${source.id} requires a type`);
    if (source.config !== undefined && !object(source.config)) throw new Error(`source ${source.id} config must be an object`);
    for (const key of ["token", "api_token", "signing_secret"]) {
      if (source.config?.[key] === "[REDACTED]") throw new Error(`source ${source.id} has a redacted ${key}; remove it and configure a secret reference or supply the reviewed credential`);
    }
  }
  for (const policy of payload.policies) {
    for (const key of ["allowed_actions", "blocked_actions"]) {
      if (!Array.isArray(policy[key]) || policy[key].some((value) => typeof value !== "string")) throw new Error(`policy ${policy.id} requires a ${key} string array`);
    }
  }
}

// Caller holds the canonical store lock. The journal is durable before any
// section changes and remains until the complete snapshot has been installed.
export async function importConfig(root, payload) {
  validateConfigImport(payload);
  await writeJsonAtomic(configImportJournalPath(root), { version: 1, root, config: payload }, { mode: 0o600 });
  await install(root, payload);
  await rm(configImportJournalPath(root));
}

// Called only under the recovery gate; never starts an outbound operation.
export async function recoverConfigImport(root) {
  const missing = Symbol("missing config journal");
  const journal = await readJson(configImportJournalPath(root), missing);
  if (journal === missing) return;
  if (!object(journal) || journal.version !== 1 || journal.root !== root) throw new Error("invalid config import journal; inspect it before recovery");
  validateConfigImport(journal.config);
  if (!(await stat(root)).isDirectory()) throw new Error("config import recovery requires the original store directory");
  await install(root, journal.config);
  await rm(configImportJournalPath(root));
}

async function install(root, payload) {
  for (const section of SECTIONS) await writeJsonAtomic(join(root, "config", `${section}.json`), payload[section]);
}

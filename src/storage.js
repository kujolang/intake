import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { DEFAULT_INTAKE_DIR, LOG_NAMES, REQUIRED_DIRS, STORAGE_SCHEMA_VERSION, VERSION } from "./constants.js";
import { runMigrations } from "./migrations.js";
import { redact } from "./redaction.js";
import { assertSafeId, dateOnly, isoNow, readJson, writeJsonAtomic, writeTextAtomic } from "./util.js";

export function resolveIntakeDir(flags = {}) {
  return flags.dir || process.env.INTAKE_DIR || DEFAULT_INTAKE_DIR;
}

export function paths(root) {
  return {
    root,
    config: join(root, "config"),
    sources: join(root, "config", "sources.json"),
    policies: join(root, "config", "policies.json"),
    rules: join(root, "config", "rules.json"),
    agents: join(root, "config", "agents.json"),
    settings: join(root, "config", "settings.json"),
    meta: join(root, "config", "meta.json"),
    items: join(root, "items"),
    actions: join(root, "actions"),
    learnings: join(root, "learnings"),
    index: join(root, "index"),
    logs: join(root, "logs"),
    raw: join(root, "raw")
  };
}

export async function initStore(root) {
  for (const dir of REQUIRED_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }
  for (const name of LOG_NAMES) {
    await appendFile(join(root, "logs", `${name}.jsonl`), "", "utf8");
  }
  await ensureJson(paths(root).sources, []);
  await ensureJson(paths(root).agents, []);
  await ensureJson(paths(root).policies, defaultPolicies());
  await ensureJson(paths(root).rules, defaultRules());
  await ensureJson(paths(root).settings, defaultSettings());
  await ensureJson(paths(root).meta, defaultMeta());
  await runMigrations(root);
  await writeTextAtomic(
    join(root, "secrets", "README.md"),
    [
      "# Intake Secrets",
      "",
      "Do not store mailbox passwords, webhook tokens, or provider API keys in normal config.",
      "Prefer OS keychain entries or environment references such as `env:INTAKE_SECRET_SOURCE_ID_PASSWORD`.",
      "This folder exists only for local operator notes and is ignored by default."
    ].join("\n") + "\n"
  );
}

async function ensureJson(path, fallback) {
  try {
    await stat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeJsonAtomic(path, fallback);
  }
}

export async function loadSources(root) {
  return readJson(paths(root).sources, []);
}

export async function saveSources(root, sources) {
  await writeJsonAtomic(paths(root).sources, sources);
}

export async function loadPolicies(root) {
  return readJson(paths(root).policies, defaultPolicies());
}

export async function savePolicies(root, policies) {
  await writeJsonAtomic(paths(root).policies, policies);
}

export async function loadRules(root) {
  return readJson(paths(root).rules, defaultRules());
}

export async function saveRules(root, rules) {
  await writeJsonAtomic(paths(root).rules, rules);
}

export async function loadSettings(root) {
  return readJson(paths(root).settings, defaultSettings());
}

export async function saveSettings(root, settings) {
  await writeJsonAtomic(paths(root).settings, settings);
}

export async function loadMeta(root) {
  return readJson(paths(root).meta, defaultMeta());
}

export async function saveItem(root, item, options = {}) {
  await writeJsonAtomic(recordPath(root, "items", item.id, "item id"), item);
  if (options.rebuildIndex !== false) {
    await upsertItemIndex(root, item);
  }
}

export async function loadItem(root, id) {
  return readJson(recordPath(root, "items", id, "item id"), null);
}

export async function deleteItem(root, id, options = {}) {
  await rm(recordPath(root, "items", id, "item id"), { force: true });
  if (options.rebuildIndex !== false) await removeItemFromIndex(root, id);
}

export async function listItems(root, filters = {}) {
  const dir = join(root, "items");
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const item = await readJson(join(dir, name), null);
    if (item && matchesFilters(item, filters)) items.push(item);
  }
  return paginateRows(items.sort(sortItems), filters);
}

export async function listItemIndex(root, filters = {}) {
  const rows = await readJson(join(root, "index", "items.json"), null);
  if (!Array.isArray(rows)) {
    await rebuildItemIndex(root);
    return listItemIndex(root, filters);
  }
  return paginateRows(rows.filter((row) => matchesFilters(row, filters)).sort(sortItems), filters);
}

export async function listItemDedupeKeys(root) {
  const rows = await readJson(join(root, "index", "items.json"), null);
  if (!Array.isArray(rows)) {
    await rebuildItemIndex(root);
    return listItemDedupeKeys(root);
  }
  if (rows.every((row) => row.dedupe_key)) {
    return rows.map((row) => row.dedupe_key);
  }
  const items = await listItems(root);
  await rebuildItemIndex(root);
  return items.map((item) => item.dedupe_key);
}

export async function saveAction(root, action, options = {}) {
  await writeJsonAtomic(recordPath(root, "actions", action.id, "action id"), action);
  if (options.rebuildIndex !== false) await upsertActionIndex(root, action);
}

export async function loadAction(root, id) {
  return readJson(recordPath(root, "actions", id, "action id"), null);
}

export async function deleteAction(root, id, options = {}) {
  await rm(recordPath(root, "actions", id, "action id"), { force: true });
  if (options.rebuildIndex !== false) await removeRecordFromIndex(root, "actions", id);
}

export async function listActions(root, filters = {}) {
  const rows = await listActionIndex(root, filters);
  return hydrateRecords(root, "actions", rows.map((row) => row.id), "action id");
}

export async function listActionIndex(root, filters = {}) {
  return listRecordIndex(root, "actions", filters, rebuildActionIndex);
}

export async function saveLearning(root, learning, options = {}) {
  await writeJsonAtomic(recordPath(root, "learnings", learning.id, "learning id"), learning);
  if (options.rebuildIndex !== false) await upsertLearningIndex(root, learning);
}

export async function loadLearning(root, id) {
  return readJson(recordPath(root, "learnings", id, "learning id"), null);
}

export async function deleteLearning(root, id, options = {}) {
  await rm(recordPath(root, "learnings", id, "learning id"), { force: true });
  if (options.rebuildIndex !== false) await removeRecordFromIndex(root, "learnings", id);
}

export async function listLearnings(root, filters = {}) {
  const rows = await listLearningIndex(root, filters);
  return hydrateRecords(root, "learnings", rows.map((row) => row.id), "learning id");
}

export async function listLearningIndex(root, filters = {}) {
  return listRecordIndex(root, "learnings", filters, rebuildLearningIndex);
}

async function listRecords(dir, filters) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const row = await readJson(join(dir, name), null);
    if (row && matchesFilters(row, filters)) rows.push(row);
  }
  return paginateRows(rows.sort(sortRecords), filters);
}

async function hydrateRecords(root, collection, ids, label) {
  const rows = [];
  for (const id of ids) {
    const row = await readJson(recordPath(root, collection, id, label), null);
    if (row) rows.push(row);
  }
  return rows;
}

async function listRecordIndex(root, collection, filters, rebuild) {
  const rows = await readJson(join(root, "index", `${collection}.json`), null);
  if (!Array.isArray(rows)) {
    await rebuild(root);
    return listRecordIndex(root, collection, filters, rebuild);
  }
  return paginateRows(rows.filter((row) => matchesFilters(row, filters)).sort(sortRecords), filters);
}

function matchesFilters(row, filters) {
  for (const [key, expected] of Object.entries(filters)) {
    if (["limit", "offset"].includes(key)) continue;
    if (expected === undefined || expected === null || expected === "") continue;
    if (key === "tag") {
      if (!Array.isArray(row.tags) || !row.tags.includes(expected)) return false;
    } else if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

function sortItems(a, b) {
  return String(b.received_at || b.created_at).localeCompare(String(a.received_at || a.created_at));
}

function sortRecords(a, b) {
  return String(b.created_at || b.timestamp || b.updated_at || "").localeCompare(String(a.created_at || a.timestamp || a.updated_at || ""));
}

function paginateRows(rows, filters = {}) {
  const offset = parseListBound(filters.offset, 0);
  const limit = filters.limit === undefined ? null : parseListBound(filters.limit, 100);
  if (limit === null) return rows.slice(offset);
  return rows.slice(offset, offset + limit);
}

export async function storeRaw(root, area, sourceId, id, extension, content) {
  const safeArea = assertSafeId(area, "raw area");
  const safeSource = assertSafeId(sourceId || "unknown", "source id");
  const safeId = assertSafeId(id, "raw id");
  const safeExtension = assertSafeId(extension, "raw extension");
  const path = join(root, "raw", safeArea, safeSource, `${safeId}.${safeExtension}`);
  await writeTextAtomic(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return relative(root, path);
}

export async function readRaw(root, relPath) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, String(relPath || ""));
  if (!target.startsWith(`${rootPath}${sep}`)) return null;
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseListBound(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export async function logEvent(root, name, entry) {
  const path = join(root, "logs", `${name}.jsonl`);
  const base = {
    timestamp: isoNow(),
    actor: "intake",
    source_id: null,
    item_id: null,
    action_id: null,
    event_type: name,
    input_refs: [],
    output_refs: [],
    status: "ok",
    risk_level: null,
    policy_result: null,
    error: null
  };
  await appendFile(path, `${JSON.stringify(redact({ ...base, ...entry }))}\n`, "utf8");
}

export async function rebuildItemIndex(root) {
  const items = await listItems(root);
  const compact = items.map(compactItemRow);
  await writeJsonAtomic(join(root, "index", "items.json"), compact);
}

export async function rebuildActionIndex(root) {
  const actions = await listRecords(join(root, "actions"), {});
  await writeJsonAtomic(join(root, "index", "actions.json"), actions.map(compactActionRow));
}

export async function rebuildLearningIndex(root) {
  const learnings = await listRecords(join(root, "learnings"), {});
  await writeJsonAtomic(join(root, "index", "learnings.json"), learnings.map(compactLearningRow));
}

async function upsertItemIndex(root, item) {
  const path = join(root, "index", "items.json");
  const rows = await readJson(path, null);
  if (!Array.isArray(rows)) {
    await rebuildItemIndex(root);
    return;
  }
  const nextRow = compactItemRow(item);
  const found = rows.findIndex((row) => row.id === item.id);
  const next = found === -1
    ? [...rows, nextRow]
    : rows.map((row, index) => index === found ? nextRow : row);
  await writeJsonAtomic(path, next.sort(sortItems));
}

async function upsertActionIndex(root, action) {
  await upsertRecordIndex(root, "actions", compactActionRow(action), rebuildActionIndex);
}

async function upsertLearningIndex(root, learning) {
  await upsertRecordIndex(root, "learnings", compactLearningRow(learning), rebuildLearningIndex);
}

async function upsertRecordIndex(root, collection, nextRow, rebuild) {
  const path = join(root, "index", `${collection}.json`);
  const rows = await readJson(path, null);
  if (!Array.isArray(rows)) {
    await rebuild(root);
    return;
  }
  const found = rows.findIndex((row) => row.id === nextRow.id);
  const next = found === -1
    ? [...rows, nextRow]
    : rows.map((row, index) => index === found ? nextRow : row);
  await writeJsonAtomic(path, next.sort(sortRecords));
}

async function removeItemFromIndex(root, id) {
  const path = join(root, "index", "items.json");
  const rows = await readJson(path, null);
  if (!Array.isArray(rows)) {
    await rebuildItemIndex(root);
    return;
  }
  await writeJsonAtomic(path, rows.filter((row) => row.id !== id));
}

async function removeRecordFromIndex(root, collection, id) {
  const path = join(root, "index", `${collection}.json`);
  const rows = await readJson(path, null);
  if (!Array.isArray(rows)) return;
  await writeJsonAtomic(path, rows.filter((row) => row.id !== id));
}

function compactItemRow(item) {
  return {
    id: item.id,
    dedupe_key: item.dedupe_key,
    source_id: item.source_id,
    source_type: item.source_type,
    title: item.title,
    status: item.status,
    queue: item.queue,
    risk_level: item.risk_level,
    category: item.category,
    tags: item.tags || [],
    received_at: item.received_at,
    updated_at: item.updated_at
  };
}

function compactActionRow(action) {
  return {
    id: action.id,
    intake_item_id: action.intake_item_id,
    source_id: action.source_id || null,
    type: action.type,
    status: action.status,
    proposed_by: action.proposed_by || null,
    approved_by: action.approved_by || null,
    risk_level: action.risk_level || null,
    confidence: action.confidence ?? null,
    created_at: action.created_at,
    approved_at: action.approved_at || null,
    executed_at: action.executed_at || null
  };
}

function compactLearningRow(learning) {
  return {
    id: learning.id,
    source_id: learning.source_id || null,
    source_item_ids: learning.source_item_ids || [],
    type: learning.type,
    title: learning.title,
    status: learning.status,
    confidence: learning.confidence ?? null,
    exported_to_strata: learning.exported_to_strata || false,
    exported_to_totalrecall: learning.exported_to_totalrecall || false,
    created_at: learning.created_at,
    reviewed_at: learning.reviewed_at || null
  };
}

export function defaultSettings() {
  return {
    version: 1,
    auto_actions_enabled: false,
    ai_enabled: false,
    ai_provider: "none",
    ai_model: null,
    ai_base_url: null,
    ai_api_key_env: null,
    strata_import_dir: null,
    totalrecall_export_dir: null,
    created_at: isoNow(),
    updated_at: isoNow()
  };
}

export function defaultMeta() {
  const now = isoNow();
  return {
    schema_version: STORAGE_SCHEMA_VERSION,
    app_version: VERSION,
    created_at: now,
    updated_at: now
  };
}

function recordPath(root, collection, id, label) {
  return join(root, collection, `${assertSafeId(id, label)}.json`);
}

export function defaultPolicies() {
  const now = isoNow();
  return [
    {
      id: "default-safe-human-gate",
      name: "Default safe human gate",
      applies_to_sources: ["*"],
      applies_to_categories: ["*"],
      allowed_actions: ["draft_response", "append_remote_draft", "export_strata", "export_totalrecall", "mark_resolved", "create_learning"],
      blocked_actions: ["send_response"],
      confidence_threshold: 0.85,
      risk_ceiling: "medium",
      requires_human_review: true,
      auto_execute_allowed: false,
      max_auto_actions_per_hour: 0,
      max_auto_actions_per_day: 0,
      created_at: now,
      updated_at: now
    }
  ];
}

export function defaultRules() {
  const now = isoNow();
  return [
    {
      id: "refund-review",
      version: 1,
      description: "Refund language routes to billing review and blocks auto-send.",
      match_any: ["refund", "chargeback", "billing dispute"],
      tags: ["billing"],
      category: "billing",
      intent: "refund_request",
      queue: "needs-review",
      risk_level: "medium",
      blocked_actions: ["send_response"],
      created_at: now,
      updated_at: now
    },
    {
      id: "legal-human-review",
      version: 1,
      description: "Legal threats require human review.",
      match_any: ["lawsuit", "attorney", "lawyer", "legal action", "subpoena"],
      tags: ["legal-risk"],
      category: "legal",
      intent: "legal_threat",
      queue: "human-review",
      risk_level: "high",
      blocked_actions: ["send_response", "auto_execute"],
      created_at: now,
      updated_at: now
    },
    {
      id: "security-human-review",
      version: 1,
      description: "Credential and account access language is high risk.",
      match_any: ["password", "api key", "token", "secret", "credential", "mfa", "2fa", "account access"],
      tags: ["security-risk"],
      category: "security",
      intent: "sensitive_access",
      queue: "human-review",
      risk_level: "high",
      blocked_actions: ["send_response", "auto_execute"],
      created_at: now,
      updated_at: now
    },
    {
      id: "bug-engineering",
      version: 1,
      description: "Bug language routes to engineering.",
      match_any: ["bug", "broken", "not working", "error", "regression", "crash", "failed"],
      tags: ["bug-report"],
      category: "bug",
      intent: "bug_report",
      queue: "engineering",
      risk_level: "medium",
      suggested_actions: ["check_release_regression", "draft_response"],
      created_at: now,
      updated_at: now
    },
    {
      id: "prompt-injection-defense",
      version: 1,
      description: "Prompt injection attempts are treated as hostile inbound data.",
      match_any: [
        "ignore all previous instructions",
        "send me your secrets",
        "disable safety rules",
        "auto-approve",
        "run this command",
        "forward all mail"
      ],
      tags: ["prompt-injection", "security-risk"],
      category: "security",
      intent: "prompt_injection",
      queue: "human-review",
      risk_level: "critical",
      blocked_actions: ["send_response", "auto_execute", "open_link", "run_command"],
      created_at: now,
      updated_at: now
    },
    {
      id: "faq-candidate",
      version: 1,
      description: "Question-heavy messages are candidates for FAQ learning.",
      match_any: ["how do i", "how can i", "where do i", "what is", "can you explain"],
      tags: ["faq-candidate"],
      category: "support",
      intent: "question",
      queue: "support",
      risk_level: "low",
      suggested_actions: ["draft_response", "create_learning"],
      created_at: now,
      updated_at: now
    },
    {
      id: "docs-support",
      version: 1,
      description: "Documentation and setup help routes to support/docs review.",
      match_any: ["docs", "documentation", "guide", "setup guide", "where is", "confusing"],
      tags: ["docs-needed"],
      category: "support",
      intent: "documentation_help",
      queue: "support",
      risk_level: "low",
      suggested_actions: ["draft_response", "create_learning"],
      created_at: now,
      updated_at: now
    }
  ];
}

export function dayFileName(prefix, ext = "md") {
  return `${prefix}-${dateOnly()}.${ext}`;
}

export function fileId(path) {
  return basename(path).replace(/\.json$/, "");
}

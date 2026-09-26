import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  deleteAction,
  deleteItem,
  deleteLearning,
  listActions,
  listItems,
  listLearnings,
  logEvent,
  rebuildItemIndex
} from "./storage.js";
import { isoNow, writeTextAtomic } from "./util.js";

const LOG_NAMES = ["sync", "normalize", "classify", "policy", "actions", "audit", "errors"];

export async function applyRetention(root, options = {}) {
  const dryRun = options.dryRun === true;
  const result = {
    ok: true,
    dry_run: dryRun,
    raw_deleted: [],
    logs_compacted: []
  };
  if (options.rawDays !== undefined) {
    result.raw_deleted = await pruneRaw(root, Number(options.rawDays), { dryRun });
  }
  if (options.logsDays !== undefined) {
    result.logs_compacted = await pruneLogs(root, Number(options.logsDays), { dryRun });
  }
  await logEvent(root, "audit", {
    event_type: "retention_applied",
    status: "ok",
    metadata: { dry_run: dryRun, raw_deleted: result.raw_deleted.length, logs_compacted: result.logs_compacted.length }
  });
  return result;
}

export async function purgeItems(root, filters = {}) {
  const dryRun = filters.dryRun === true;
  const matched = await matchingItems(root, filters);
  if (!filters.force && !dryRun) {
    throw new Error("purge requires --force or --dry-run");
  }
  const actions = await listActions(root);
  const learnings = await listLearnings(root);
  const itemIds = new Set(matched.map((item) => item.id));
  const actionIds = actions.filter((action) => itemIds.has(action.intake_item_id)).map((action) => action.id);
  const learningIds = learnings
    .filter((learning) => (learning.source_item_ids || []).some((id) => itemIds.has(id)))
    .map((learning) => learning.id);
  const rawPaths = [...new Set(matched.flatMap((item) => [
    item.raw_payload_path,
    ...(item.attachments || []).map((attachment) => attachment.quarantine_path)
  ]).filter(Boolean))];

  if (!dryRun) {
    for (const actionId of actionIds) await deleteAction(root, actionId);
    for (const learningId of learningIds) await deleteLearning(root, learningId);
    for (const rawPath of rawPaths) await removeRelative(root, rawPath);
    for (const item of matched) await deleteItem(root, item.id, { rebuildIndex: false });
    await rebuildItemIndex(root);
  }

  const result = {
    ok: true,
    dry_run: dryRun,
    items: matched.map((item) => item.id),
    actions: actionIds,
    learnings: learningIds,
    raw_payloads: rawPaths
  };
  await logEvent(root, "audit", {
    event_type: "items_purged",
    status: dryRun ? "dry_run" : "ok",
    metadata: {
      dry_run: dryRun,
      item_count: result.items.length,
      action_count: result.actions.length,
      learning_count: result.learnings.length,
      raw_count: result.raw_payloads.length
    }
  });
  return result;
}

async function matchingItems(root, filters) {
  if (!filters.source && !filters.status && !filters.queue && !filters.before && !filters.item) {
    throw new Error("purge requires at least one selector: --item, --source, --status, --queue, or --before");
  }
  const beforeMs = parseOptionalDate(filters.before, "--before");
  const items = await listItems(root);
  return items.filter((item) => {
    if (filters.item && item.id !== filters.item) return false;
    if (filters.source && item.source_id !== filters.source) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.queue && item.queue !== filters.queue) return false;
    if (beforeMs !== null && itemTimestamp(item) >= beforeMs) return false;
    return true;
  });
}

function parseOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(`${label} must be a valid date`);
  return time;
}

function itemTimestamp(item) {
  const time = new Date(item.received_at || item.created_at).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

async function pruneRaw(root, days, options) {
  if (!Number.isFinite(days) || days < 0) throw new Error("raw retention days must be a non-negative number");
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rawRoot = join(root, "raw");
  const files = await listFiles(rawRoot);
  const deleted = [];
  for (const file of files) {
    const info = await stat(file);
    if (info.mtimeMs >= cutoff) continue;
    deleted.push(relative(root, file));
    if (!options.dryRun) await rm(file, { force: true });
  }
  return deleted;
}

async function pruneLogs(root, days, options) {
  if (!Number.isFinite(days) || days < 0) throw new Error("log retention days must be a non-negative number");
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const compacted = [];
  for (const name of LOG_NAMES) {
    const path = join(root, "logs", `${name}.jsonl`);
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      continue;
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const kept = [];
    let removed = 0;
    for (const line of lines) {
      const timestamp = parseLogTimestamp(line);
      if (timestamp && timestamp < cutoff) {
        removed += 1;
      } else {
        kept.push(line);
      }
    }
    if (removed > 0) {
      compacted.push({ log: name, removed, kept: kept.length });
      if (!options.dryRun) {
        await mkdir(dirname(path), { recursive: true });
        await writeTextAtomic(path, `${kept.join("\n")}${kept.length ? "\n" : ""}`);
      }
    }
  }
  return compacted;
}

function parseLogTimestamp(line) {
  try {
    const parsed = JSON.parse(line);
    const time = new Date(parsed.timestamp).getTime();
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

async function listFiles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    if (entry.isFile()) out.push(path);
  }
  return out;
}

async function removeRelative(root, relPath) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, String(relPath || ""));
  if (!target.startsWith(`${rootPath}${sep}`)) throw new Error(`unsafe raw payload path: ${relPath}`);
  await rm(target, { force: true });
}

export function retentionHint() {
  return {
    generated_at: isoNow(),
    examples: [
      "intake retention apply --raw-days 90 --logs-days 180 --dry-run",
      "intake purge items --status resolved --before 2026-01-01 --dry-run",
      "intake purge items --source support-email --status resolved --force"
    ]
  };
}

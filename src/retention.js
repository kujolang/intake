import { withStoreLock } from "./store-lock.js";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
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
import { isoNow } from "./util.js";

const LOG_NAMES = ["sync", "normalize", "classify", "policy", "actions", "audit", "errors"];

export async function applyRetention(root, options = {}) {
  return withStoreLock(root, () => applyRetentionLocked(root, options));
}

async function applyRetentionLocked(root, options = {}) {
  // Validate the complete request before either destructive phase starts.
  const rawDays = retentionDays(options.rawDays, "raw");
  const logsDays = retentionDays(options.logsDays, "log");
  const dryRun = options.dryRun === true;
  const result = {
    ok: true,
    dry_run: dryRun,
    raw_deleted: [],
    logs_compacted: []
  };
  if (options.rawDays !== undefined) {
    result.raw_deleted = await pruneRaw(root, rawDays, { dryRun });
  }
  if (options.logsDays !== undefined) {
    result.logs_compacted = await pruneLogs(root, logsDays, { dryRun });
  }
  await logEvent(root, "audit", {
    event_type: "retention_applied",
    status: "ok",
    metadata: { dry_run: dryRun, raw_deleted: result.raw_deleted.length, logs_compacted: result.logs_compacted.length }
  });
  return result;
}

export async function purgeItems(root, filters = {}) {
  return withStoreLock(root, () => purgeItemsLocked(root, filters));
}

async function purgeItemsLocked(root, filters = {}) {
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
  const targets = [];
  for (const rawPath of rawPaths) targets.push(await rawDeletionTarget(root, rawPath));

  if (!dryRun) {
    for (const actionId of actionIds) await deleteAction(root, actionId);
    for (const learningId of learningIds) await deleteLearning(root, learningId);
    for (const target of targets) await rm(target, { force: true });
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
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const compacted = [];
  for (const name of LOG_NAMES) {
    const path = join(root, "logs", `${name}.jsonl`);
    let file;
    try {
      file = await open(path, "r");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      continue;
    }
    const tmp = `${path}.tmp-${randomUUID()}`;
    const input = file.createReadStream({ autoClose: false, encoding: "utf8" });
    let kept = 0;
    let removed = 0;
    async function* compact() {
      for await (const line of logLines(input)) {
        if (!line) continue;
        const timestamp = parseLogTimestamp(line);
        if (timestamp !== null && timestamp < cutoff) removed += 1;
        else {
          kept += 1;
          yield `${line}\n`;
        }
      }
    }
    try {
      if (options.dryRun) {
        for await (const line of compact()) { /* Count without writing. */ }
      } else {
        const mode = (await file.stat()).mode & 0o777;
        await pipeline(compact(), createWriteStream(tmp, { flags: "wx", mode }));
        if (removed > 0) await rename(tmp, path);
      }
      if (removed > 0) compacted.push({ log: name, removed, kept });
    } finally {
      input.destroy();
      await file.close();
      await rm(tmp, { force: true });
    }
  }
  return compacted;
}

function parseLogTimestamp(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed.timestamp === null || parsed.timestamp === undefined) return null;
    const time = new Date(parsed.timestamp).getTime();
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

async function* logLines(input) {
  let pending = "";
  for await (const chunk of input) {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop();
    for (const line of lines) yield line.endsWith("\r") ? line.slice(0, -1) : line;
  }
  if (pending) yield pending;
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

function retentionDays(value, label) {
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) throw new Error(`${label} retention days must be a non-negative number`);
  return days;
}

async function rawDeletionTarget(root, relPath) {
  const rootPath = resolve(root);
  const rawRoot = resolve(rootPath, "raw");
  const target = resolve(rootPath, String(relPath || ""));
  if (!target.startsWith(`${rawRoot}${sep}`)) throw new Error(`unsafe raw payload path: ${relPath}`);
  let current = rootPath;
  for (const part of relative(rootPath, target).split(sep)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error.code === "ENOENT") break; throw error; }
    if (info.isSymbolicLink() || (current === target && !info.isFile())) throw new Error(`unsafe raw payload path: ${relPath}`);
  }
  return target;
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

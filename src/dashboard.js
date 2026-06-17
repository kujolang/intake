import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testSource } from "./adapters/index.js";
import { buildSourceFromInput, sanitizeSource, sanitizeSources } from "./source-config.js";
import { initStore, listActions, listItemIndex, listLearnings, loadAction, loadItem, loadPolicies, loadRules, loadSettings, loadSources, readRaw, saveItem, savePolicies, saveSettings, saveSources, logEvent } from "./storage.js";
import { evaluatePolicy } from "./policy.js";
import { appendSourceSyncHistory, appendSourceTestHistory } from "./source-history.js";
import { approveAction, classifyAndSave, createLearning, proposeDraft, rejectAction, runAction, setAutoActions, syncAll } from "./workflow.js";
import { isoNow, parseCsv, readStreamText, uniq } from "./util.js";

const LOGS = ["sync", "normalize", "classify", "policy", "actions", "audit", "errors"];
const MAX_DASHBOARD_BODY_BYTES = 1024 * 1024;
const ICON_NAMES = [
  "alert-triangle",
  "bolt",
  "brain",
  "check",
  "clipboard-list",
  "cloud-download",
  "database",
  "device-floppy",
  "edit",
  "file-text",
  "folder",
  "inbox",
  "key",
  "list",
  "lock",
  "mail",
  "player-play",
  "plug-connected",
  "plug",
  "plus",
  "power",
  "refresh",
  "ruler",
  "search",
  "send",
  "settings",
  "shield",
  "tag",
  "user",
  "x"
];
const ICONS = Object.fromEntries(ICON_NAMES.map((name) => [name, loadTablerIcon(name)]));

function loadTablerIcon(name) {
  try {
    return readFileSync(join(process.cwd(), "node_modules", "@tabler", "icons", "icons", "outline", `${name}.svg`), "utf8")
      .replace(/\s(width|height)="24"/g, "")
      .replace("<svg ", `<svg class="icon icon-${name}" aria-hidden="true" focusable="false" `);
  } catch {
    return "";
  }
}

export async function startDashboard(root, options = {}) {
  await initStore(root);
  const host = options.host || "127.0.0.1";
  const localOnly = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!localOnly && options.allowNonLocal !== true) {
    throw new Error("dashboard binds to localhost by default; pass --allow-non-local with --tls-cert and --tls-key for non-local binding");
  }
  if (!localOnly && (!options.tlsCert || !options.tlsKey)) {
    throw new Error("non-local dashboard binding requires --tls-cert and --tls-key");
  }
  const port = Number(options.port ?? 8787);
  let activeToken = options.token || process.env.INTAKE_DASHBOARD_TOKEN || randomBytes(24).toString("base64url");

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
        return sendHtml(res, dashboardHtml());
      }
      if (url.pathname === "/healthz") return sendJson(res, { ok: true, local_only: true });
      if (!authorized(req, url, activeToken)) return sendJson(res, { error: "unauthorized" }, 401);
      const body = await parseBody(req);
      const result = await routeApi(root, req.method, url, body, {
        dashboardToken: () => activeToken,
        rotateDashboardToken: () => {
          activeToken = randomBytes(24).toString("base64url");
          return activeToken;
        }
      });
      return sendJson(res, result);
    } catch (error) {
      await logEvent(root, "errors", { event_type: "dashboard_error", status: "failed", error: error.message });
      return sendJson(res, { error: error.message }, error.statusCode || 500);
    }
  };
  const server = options.tlsCert && options.tlsKey
    ? createHttpsServer({ cert: readFileSync(options.tlsCert), key: readFileSync(options.tlsKey) }, handler)
    : createHttpServer(handler);

  await new Promise((resolve) => server.listen(port, host, resolve));
  await logEvent(root, "audit", { event_type: "dashboard_started", status: "ok" });
  const protocol = options.tlsCert && options.tlsKey ? "https" : "http";
  return { server, host, port: server.address().port, token: activeToken, url: `${protocol}://${host}:${server.address().port}/?token=${encodeURIComponent(activeToken)}` };
}

async function routeApi(root, method, url, body, session = {}) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") throw new Error("not found");

  if (method === "GET" && parts[1] === "summary") return summary(root);
  if (method === "GET" && parts[1] === "items" && parts.length === 2) {
    return { items: await listItemIndex(root, filtersFrom(url)) };
  }
  if (method === "GET" && parts[1] === "items" && parts[3] === "raw") {
    const item = await requireItem(root, parts[2]);
    return { item_id: item.id, raw: await readRaw(root, item.raw_payload_path) };
  }
  if (method === "GET" && parts[1] === "items" && parts[2]) {
    return { item: await requireItem(root, parts[2]) };
  }
  if (method === "POST" && parts[1] === "items" && parts[2]) {
    return mutateItem(root, parts[2], parts[3], body);
  }
  if (method === "GET" && parts[1] === "actions" && parts.length === 2) return { actions: await listActions(root, listFiltersFrom(url)) };
  if (method === "GET" && parts[1] === "approval-audit") return approvalAudit(root, url);
  if (method === "GET" && parts[1] === "actions" && parts[2]) return { action: await loadAction(root, parts[2]) };
  if (method === "POST" && parts[1] === "actions" && parts[2]) return mutateAction(root, parts[2], parts[3]);
  if (method === "GET" && parts[1] === "sources") return { sources: sanitizeSources(await loadSources(root)) };
  if (method === "POST" && parts[1] === "sources" && parts.length === 2) return addSource(root, body);
  if (method === "POST" && parts[1] === "sources" && parts[2]) return mutateSource(root, parts[2], parts[3], body);
  if (method === "GET" && parts[1] === "learnings") return { learnings: await listLearnings(root, listFiltersFrom(url)) };
  if (method === "GET" && parts[1] === "rules") return { rules: await loadRules(root) };
  if (method === "GET" && parts[1] === "policies") return { policies: await loadPolicies(root) };
  if (method === "POST" && parts[1] === "policies") return updatePolicies(root, body);
  if (method === "POST" && parts[1] === "policy" && parts[2] === "preview") return policyPreview(root, body);
  if (method === "GET" && parts[1] === "logs") return { logs: await readLogs(root, url.searchParams.get("name") || "audit", listFiltersFrom(url)) };
  if (method === "GET" && parts[1] === "settings") return { settings: await loadSettings(root) };
  if (method === "GET" && parts[1] === "dashboard-token") return dashboardTokenInfo(session.dashboardToken?.());
  if (method === "POST" && parts[1] === "dashboard-token" && parts[2] === "rotate") return rotateDashboardToken(root, session.rotateDashboardToken);
  if (method === "POST" && parts[1] === "settings" && parts[2] === "auto-actions") {
    return { settings: await setAutoActions(root, body.enabled === true) };
  }
  if (method === "POST" && parts[1] === "settings" && parts[2] === "update") return updateSettings(root, body);
  throw new Error("not found");
}

async function summary(root) {
  const [items, actions, learnings, settings] = await Promise.all([
    listItemIndex(root),
    listActions(root),
    listLearnings(root),
    loadSettings(root)
  ]);
  return {
    counts: {
      items: items.length,
      actions: actions.length,
      learnings: learnings.length,
      needs_review: items.filter((item) => item.status === "needs_review" || item.queue === "human-review").length,
      high_risk: items.filter((item) => ["high", "critical"].includes(item.risk_level)).length
    },
    queues: countBy(items, "queue"),
    risks: countBy(items, "risk_level"),
    statuses: countBy(items, "status"),
    settings
  };
}

async function mutateItem(root, itemId, action, body) {
  const item = await requireItem(root, itemId);
  if (action === "classify") return classifyAndSave(root, itemId, { ai: body.ai === true });
  if (action === "draft") return { action: await proposeDraft(root, itemId, { body: body.body }) };
  if (action === "learn") return { learning: await createLearning(root, itemId, body) };
  if (action === "resolve") {
    const next = { ...item, status: "resolved", queue: "resolved", updated_at: isoNow() };
    await saveItem(root, next);
    await logEvent(root, "audit", { source_id: item.source_id, item_id: item.id, event_type: "dashboard_item_resolved" });
    return { item: next };
  }
  if (action === "block") {
    const next = { ...item, status: "blocked", queue: "blocked", updated_at: isoNow() };
    await saveItem(root, next);
    await logEvent(root, "audit", { source_id: item.source_id, item_id: item.id, event_type: "dashboard_item_blocked", risk_level: item.risk_level });
    return { item: next };
  }
  if (action === "queue") {
    const next = { ...item, queue: body.queue || item.queue, status: body.queue === "resolved" ? "resolved" : "queued", updated_at: isoNow() };
    await saveItem(root, next);
    return { item: next };
  }
  if (action === "tag") {
    const tags = uniq([...(item.tags || []), ...parseCsv(body.tag || body.tags)]);
    const next = { ...item, tags, updated_at: isoNow() };
    await saveItem(root, next);
    return { item: next };
  }
  if (action === "assign") {
    const field = body.kind === "human" ? "assigned_human" : "assigned_agent";
    const next = { ...item, [field]: body.assignee, status: "assigned", updated_at: isoNow() };
    await saveItem(root, next);
    return { item: next };
  }
  throw new Error("unknown item action");
}

async function mutateAction(root, actionId, action) {
  if (action === "approve") return { action: await approveAction(root, actionId, "dashboard") };
  if (action === "reject") return { action: await rejectAction(root, actionId, "dashboard") };
  if (action === "run") return { action: await runAction(root, actionId) };
  throw new Error("unknown action command");
}

async function approvalAudit(root, url) {
  const filters = approvalAuditFilters(url);
  const actions = await listActions(root);
  const items = new Map();
  const rows = [];
  for (const action of actions) {
    if (!action.approved_by && !action.approved_at) continue;
    let item = null;
    if (action.intake_item_id) {
      if (!items.has(action.intake_item_id)) items.set(action.intake_item_id, await loadItem(root, action.intake_item_id));
      item = items.get(action.intake_item_id);
    }
    const decisionAt = action.approved_at || action.executed_at || action.created_at || "";
    const row = {
      action_id: action.id,
      item_id: action.intake_item_id || "",
      source_id: item?.source_id || action.source_id || "unknown",
      operator: action.approved_by || "unknown",
      action_type: action.type || "unknown",
      status: action.status || "unknown",
      risk_level: action.risk_level || item?.risk_level || "",
      decision_at: decisionAt,
      executed_at: action.executed_at || ""
    };
    if (matchesApprovalAuditFilters(row, filters)) rows.push(row);
  }
  const byOperator = {};
  const byType = {};
  const bySource = {};
  const byStatus = {};
  for (const row of rows) {
    byOperator[row.operator] = (byOperator[row.operator] || 0) + 1;
    byType[row.action_type] = (byType[row.action_type] || 0) + 1;
    bySource[row.source_id] = (bySource[row.source_id] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }
  const result = {
    approvals: {
      total: rows.length,
      by_operator: byOperator,
      by_type: byType,
      by_source: bySource,
      by_status: byStatus
    },
    filters,
    rows
  };
  if (filters.format === "csv") result.csv = approvalAuditCsv(rows);
  return result;
}

function approvalAuditFilters(url) {
  return {
    operator: nullableString(url.searchParams.get("operator")),
    action_type: nullableString(url.searchParams.get("action_type")),
    source_id: nullableString(url.searchParams.get("source_id")),
    status: nullableString(url.searchParams.get("status")),
    date_from: nullableString(url.searchParams.get("date_from")),
    date_to: nullableString(url.searchParams.get("date_to")),
    format: nullableString(url.searchParams.get("format"))
  };
}

function matchesApprovalAuditFilters(row, filters) {
  if (filters.operator && row.operator !== filters.operator) return false;
  if (filters.action_type && row.action_type !== filters.action_type) return false;
  if (filters.source_id && row.source_id !== filters.source_id) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.date_from && row.decision_at && row.decision_at < filters.date_from) return false;
  if (filters.date_to && row.decision_at && row.decision_at > auditDateUpperBound(filters.date_to)) return false;
  return true;
}

function auditDateUpperBound(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

function approvalAuditCsv(rows) {
  const headers = ["action_id", "item_id", "source_id", "operator", "action_type", "status", "risk_level", "decision_at", "executed_at"];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n") + "\n";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function policyPreview(root, body) {
  const itemId = body.item_id || body.itemId;
  const actionType = body.action_type || body.actionType;
  if (!itemId || !actionType) throw new Error("policy preview requires item_id and action_type");
  const item = await requireItem(root, itemId);
  const sources = await loadSources(root);
  const source = sources.find((candidate) => candidate.id === item.source_id) || null;
  const result = evaluatePolicy({
    item,
    actionType,
    policies: await loadPolicies(root),
    settings: await loadSettings(root),
    source
  });
  return { item_id: item.id, action_type: actionType, result };
}

async function updateSettings(root, body) {
  const current = await loadSettings(root);
  const next = {
    ...current,
    auto_actions_enabled: body.auto_actions_enabled === true,
    ai_enabled: body.ai_enabled === true,
    ai_provider: String(body.ai_provider || "none").trim() || "none",
    strata_import_dir: nullableString(body.strata_import_dir),
    totalrecall_export_dir: nullableString(body.totalrecall_export_dir),
    updated_at: isoNow()
  };
  await saveSettings(root, next);
  await logEvent(root, "audit", { event_type: "dashboard_settings_updated" });
  return { settings: next };
}

function dashboardTokenInfo(token) {
  const text = String(token || "");
  return {
    token: text ? `${"*".repeat(Math.max(0, text.length - 6))}${text.slice(-6)}` : "",
    length: text.length,
    ephemeral: process.env.INTAKE_DASHBOARD_TOKEN ? false : true
  };
}

async function rotateDashboardToken(root, rotate) {
  if (typeof rotate !== "function") throw new Error("dashboard token rotation is unavailable");
  const token = rotate();
  await logEvent(root, "audit", { event_type: "dashboard_token_rotated", status: "ok" });
  return { token, token_info: dashboardTokenInfo(token) };
}

async function updatePolicies(root, body) {
  if (!Array.isArray(body.policies)) throw new Error("policies must be an array");
  for (const policy of body.policies) {
    if (!policy || typeof policy !== "object" || !policy.id) throw new Error("each policy requires an id");
    if (!Array.isArray(policy.allowed_actions) || !Array.isArray(policy.blocked_actions)) {
      throw new Error(`policy ${policy.id} requires allowed_actions and blocked_actions arrays`);
    }
  }
  await savePolicies(root, body.policies.map((policy) => ({ ...policy, updated_at: isoNow() })));
  await logEvent(root, "audit", { event_type: "dashboard_policies_updated" });
  return { policies: await loadPolicies(root) };
}

function nullableString(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function addSource(root, body) {
  const sources = await loadSources(root);
  const source = buildSourceFromInput(body);
  if (sources.some((candidate) => candidate.id === source.id)) {
    throw new Error(`source already exists: ${source.id}`);
  }
  await saveSources(root, [...sources, source]);
  await logEvent(root, "audit", { source_id: source.id, event_type: "dashboard_source_added" });
  return { source: sanitizeSource(source) };
}

async function mutateSource(root, sourceId, action, body) {
  const sources = await loadSources(root);
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`no such source: ${sourceId}`);
  if (action === "update") {
    const next = buildSourceFromInput({ ...body, id: sourceId }, source);
    await saveSources(root, sources.map((candidate) => candidate.id === sourceId ? next : candidate));
    await logEvent(root, "audit", { source_id: sourceId, event_type: "dashboard_source_updated" });
    return { source: sanitizeSource(next) };
  }
  if (action === "enable" || action === "disable") {
    const next = { ...source, enabled: action === "enable", updated_at: isoNow() };
    await saveSources(root, sources.map((candidate) => candidate.id === sourceId ? next : candidate));
    return { source: sanitizeSource(next) };
  }
  if (action === "remove") {
    await saveSources(root, sources.filter((candidate) => candidate.id !== sourceId));
    await logEvent(root, "audit", { source_id: sourceId, event_type: "dashboard_source_removed" });
    return { removed: sourceId };
  }
  if (action === "test") {
    try {
      const result = await testSource(source);
      const testedAt = isoNow();
      const next = appendSourceTestHistory({ ...source, last_tested_at: testedAt, last_test_result: result, updated_at: testedAt }, result, testedAt);
      await saveSources(root, sources.map((candidate) => candidate.id === sourceId ? next : candidate));
      await logEvent(root, result.ok ? "audit" : "errors", {
        source_id: sourceId,
        event_type: "dashboard_source_tested",
        status: result.ok ? "ok" : "failed",
        error: result.errors?.join("; ") || null
      });
      return { result };
    } catch (error) {
      const result = { ok: false, errors: [error.message] };
      const testedAt = isoNow();
      const next = appendSourceTestHistory({ ...source, last_tested_at: testedAt, last_test_result: result, updated_at: testedAt }, result, testedAt);
      await saveSources(root, sources.map((candidate) => candidate.id === sourceId ? next : candidate));
      return { result };
    }
  }
  if (action === "sync") {
    try {
      return { result: { ok: true, sync: await syncAll(root, sourceId) } };
    } catch (error) {
      const syncedAt = isoNow();
      const result = { ok: false, errors: [error.message] };
      const next = appendSourceSyncHistory({ ...source, last_synced_at: syncedAt, last_sync_result: result, updated_at: syncedAt }, result, syncedAt);
      await saveSources(root, sources.map((candidate) => candidate.id === sourceId ? next : candidate));
      await logEvent(root, "errors", { source_id: sourceId, event_type: "dashboard_source_sync_failed", status: "failed", error: error.message });
      return { result };
    }
  }
  throw new Error("unknown source command");
}

async function requireItem(root, id) {
  const item = await loadItem(root, id);
  if (!item) throw new Error(`no such item: ${id}`);
  return item;
}

function filtersFrom(url) {
  return {
    queue: url.searchParams.get("queue") || undefined,
    source_id: url.searchParams.get("source") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    risk_level: url.searchParams.get("risk") || undefined,
    status: url.searchParams.get("status") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    offset: url.searchParams.get("offset") || undefined
  };
}

function listFiltersFrom(url) {
  return {
    status: url.searchParams.get("status") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    offset: url.searchParams.get("offset") || undefined
  };
}

async function readLogs(root, name, filters = {}) {
  if (!LOGS.includes(name)) throw new Error("unknown log");
  const limit = filters.limit === undefined ? 200 : Math.max(0, Number(filters.limit || 200));
  const offset = Math.max(0, Number(filters.offset || 0));
  const raw = await readFile(join(root, "logs", `${name}.jsonl`), "utf8").catch(() => "");
  const rows = raw.trim().split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parse_error: true, line };
    }
  }).reverse();
  return Number.isFinite(limit) ? rows.slice(offset, offset + limit) : rows.slice(offset);
}

async function parseBody(req) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return {};
  const raw = await readStreamText(req, { maxBytes: MAX_DASHBOARD_BODY_BYTES, label: "dashboard request body" });
  if (!raw) return {};
  return JSON.parse(raw);
}

function authorized(req, url, token) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return bearer === token || req.headers["x-intake-token"] === token || url.searchParams.get("token") === token;
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  res.end(html);
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) out[row[field] || "unknown"] = (out[row[field] || "unknown"] || 0) + 1;
  return out;
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kujo Intake</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17211f;
      --muted: #5d6b67;
      --line: #d9e1dc;
      --soft: #edf4f0;
      --paper: #f7faf8;
      --panel: #ffffff;
      --accent: #16635b;
      --accent-2: #8a3b2a;
      --warn: #9b6118;
      --danger: #9f2636;
      --ok: #256548;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--paper); }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; padding: 7px 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
    button:hover { border-color: #aec6bd; background: #f9fbfa; }
    .icon { width: 17px; height: 17px; flex: 0 0 auto; stroke-width: 2; }
    .icon-btn { width: 36px; height: 36px; padding: 0; }
    .icon-btn .icon { width: 18px; height: 18px; }
    button.primary { background: var(--accent); color: white; border-color: var(--accent); }
    button.primary:hover { background: #11564f; border-color: #11564f; }
    button.danger { color: var(--danger); border-color: #e5b3bb; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    input, select, textarea { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: #fbfdfc; color: var(--ink); min-width: 0; }
    input:focus, select:focus, textarea:focus { outline: 2px solid #bedbd3; outline-offset: 1px; border-color: var(--accent); }
    textarea { width: 100%; min-height: 122px; resize: vertical; line-height: 1.45; }
    .app { display: grid; grid-template-columns: 260px minmax(400px, 1fr) 340px; min-height: 100vh; }
    aside { border-right: 1px solid var(--line); background: linear-gradient(180deg, #eef5f1 0%, #f7faf8 100%); padding: 16px; overflow: auto; }
    main { min-width: 0; padding: 18px; overflow: auto; background: var(--paper); }
    .sidepanel { border-left: 1px solid var(--line); padding: 18px; overflow: auto; background: linear-gradient(180deg, #f3f8f5 0%, #fbfcfb 100%); }
    .brand { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    .brand h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .top-actions { display: flex; align-items: center; gap: 6px; }
    .kill { color: var(--muted); }
    .kill.on { color: var(--danger); border-color: #e5b3bb; }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
    .metric { border: 1px solid var(--line); border-radius: 7px; padding: 10px; background: white; min-height: 68px; }
    .metric b { display: block; font-size: 22px; margin-bottom: 4px; }
    .metric span, .muted { color: var(--muted); font-size: 13px; }
    .filters { display: grid; gap: 8px; margin-bottom: 14px; }
    .queue-list { display: grid; gap: 6px; }
    .queue-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; }
    .queue-btn.active { border-color: var(--accent); color: var(--accent); background: #e8f3ef; }
    .toolbar { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    .tab { background: #ffffff; }
    .tab.active { background: var(--ink); color: white; border-color: var(--ink); }
    .split { display: grid; grid-template-columns: minmax(280px, 38%) minmax(320px, 1fr); gap: 12px; min-height: 70vh; }
    .list { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: white; }
    .item-row { width: 100%; display: grid; gap: 5px; padding: 11px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; text-align: left; background: white; }
    .item-row.active { background: #e9f2ef; }
    .item-title { font-weight: 700; overflow-wrap: anywhere; }
    .rowmeta { display: flex; gap: 6px; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
    .pill { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; background: #fafbfb; font-size: 12px; }
    .pill.high, .pill.critical { color: var(--danger); border-color: #e6b0b9; }
    .pill.medium { color: var(--warn); border-color: #e6c799; }
    .detail { border: 1px solid var(--line); border-radius: 8px; background: white; padding: 14px; min-width: 0; }
    .surface { border: 0; border-radius: 0; background: transparent; padding: 0; min-width: 0; }
    .detail h2, .surface h2 { margin: 0 0 8px; font-size: 19px; overflow-wrap: anywhere; }
    .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
    .field { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 10px; }
    .bodytext, pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .quick-actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 8px 0 12px; }
    .quick-actions button { width: 100%; min-width: 0; }
    .formrow { display: flex; gap: 8px; margin: 8px 0; }
    .formrow > * { flex: 1; }
    .work-field { display: grid; gap: 5px; margin: 10px 0; }
    .work-field label { color: var(--muted); font-size: 12px; }
    .work-field .formrow { margin: 0; }
    .hidden { display: none !important; }
    .stack { display: grid; gap: 10px; }
    .action-row, .learning-row, .rule-row, .log-row, .source-row, .empty-state { border: 1px solid var(--line); border-radius: 7px; padding: 10px; background: white; }
    .log-row { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .statusline { min-height: 20px; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
    .source-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0 14px; padding: 12px; border-radius: 8px; background: #ffffff; }
    .source-form .wide { grid-column: span 3; }
    .source-form label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
    .setup-guide { display: grid; gap: 10px; margin-bottom: 12px; }
    .setup-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .setup-step { border: 1px solid var(--line); border-radius: 7px; padding: 9px; background: #fbfdfc; min-height: 74px; }
    .setup-step b { display: block; font-size: 13px; margin-bottom: 4px; }
    .setup-step.done { border-color: #b9d7c9; background: #eef8f3; }
    .setup-step.warn { border-color: #e5cda8; background: #fff9ee; }
    .preset-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .preset-grid button { min-height: 72px; align-items: flex-start; justify-content: flex-start; text-align: left; display: grid; gap: 4px; }
    .preset-grid small { color: var(--muted); line-height: 1.35; }
    .diagnostics { grid-column: span 3; border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 8px; }
    .diagnostic-row { display: grid; grid-template-columns: 90px 80px 1fr; gap: 8px; align-items: center; font-size: 13px; }
    .diagnostic-row .ok { color: var(--ok); font-weight: 700; }
    .diagnostic-row .fail { color: var(--danger); font-weight: 700; }
    .diagnostic-row .skip { color: var(--muted); font-weight: 700; }
    @media (max-width: 1120px) { .app { grid-template-columns: 240px 1fr; } .sidepanel { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--line); } }
    @media (max-width: 960px) { .setup-steps, .preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .app, .split { display: block; } aside, main, .sidepanel { border: 0; border-bottom: 1px solid var(--line); } .list { margin-bottom: 12px; } .source-form, .setup-steps, .preset-grid { grid-template-columns: 1fr; } .source-form .wide, .diagnostics { grid-column: auto; } .diagnostic-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <div class="brand">
        <h1>Kujo Intake</h1>
        <div class="top-actions">
          <button id="killSwitch" class="kill icon-btn" title="Auto-actions off" aria-label="Auto-actions off" data-icon="power"></button>
          <button id="refreshBtn" class="icon-btn" title="Refresh" aria-label="Refresh" data-icon="refresh"></button>
        </div>
      </div>
      <div class="metrics" id="metrics"></div>
      <div class="filters">
        <input id="searchBox" placeholder="Filter text">
        <select id="riskFilter"><option value="">Any risk</option><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
        <select id="statusFilter"><option value="">Any status</option><option>new</option><option>triaged</option><option>needs_review</option><option>draft_ready</option><option>resolved</option><option>blocked</option></select>
      </div>
      <div class="queue-list" id="queues"></div>
    </aside>
    <main>
      <div class="toolbar">
        <div class="tabs">
          <button class="tab active" data-view="items" data-icon="inbox">Items</button>
          <button class="tab" data-view="sources" data-icon="plug-connected">Sources</button>
          <button class="tab" data-view="actions" data-icon="bolt">Actions</button>
          <button class="tab" data-view="learnings" data-icon="brain">Learnings</button>
          <button class="tab" data-view="rules" data-icon="ruler">Rules</button>
          <button class="tab" data-view="logs" data-icon="clipboard-list">Audit</button>
          <button class="tab" data-view="settings" data-icon="settings">Settings</button>
        </div>
        <div class="statusline" id="status"></div>
      </div>
      <section id="itemsView" class="split">
        <div class="list" id="itemList"></div>
        <div class="detail" id="itemDetail"></div>
      </section>
      <section id="sourcesView" class="surface hidden"><h2>Sources</h2><div id="sourceEditor"></div><div class="stack" id="sourcesList"></div></section>
      <section id="actionsView" class="surface hidden"><h2>Actions</h2><div class="stack" id="actionsList"></div></section>
      <section id="learningsView" class="surface hidden"><h2>Learnings</h2><div class="stack" id="learningsList"></div></section>
      <section id="rulesView" class="surface hidden"><h2>Rules</h2><div class="stack" id="rulesList"></div></section>
      <section id="logsView" class="surface hidden"><h2>Audit Log</h2><div class="formrow"><select id="logSelect"><option>audit</option><option>actions</option><option>classify</option><option>sync</option><option>normalize</option><option>policy</option><option>errors</option></select></div><div class="stack" id="logsList"></div></section>
      <section id="settingsView" class="surface hidden"><h2>Settings</h2><div class="stack" id="settingsPanel"></div></section>
    </main>
    <section class="sidepanel">
      <h2>Work Surface</h2>
      <div id="workSurface" class="stack"></div>
    </section>
  </div>
  <script>
    const ICONS = ${JSON.stringify(ICONS)};
    const tokenFromUrl = new URL(location.href).searchParams.get("token");
    if (tokenFromUrl) sessionStorage.setItem("intakeToken", tokenFromUrl);
    const token = sessionStorage.getItem("intakeToken") || "";
    const state = { items: [], sources: [], summary: null, selectedQueue: "", selectedItemId: null, selectedSourceId: "", selectedItem: null, selectedView: "items", sourceDiagnostics: {}, pendingSourceAction: "", policyPreview: null, setupProfile: "email", approvalAuditFilters: { operator: "", action_type: "", source_id: "", status: "", date_from: "", date_to: "" } };
    const qs = (s) => document.querySelector(s);
    const el = (tag, attrs = {}, children = []) => {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
      for (const child of [].concat(children)) node.append(child);
      return node;
    };
    function decorateStaticIcons() {
      document.querySelectorAll("[data-icon]").forEach((node) => {
        const name = node.getAttribute("data-icon");
        if (!name || !ICONS[name] || node.querySelector(".icon")) return;
        node.insertAdjacentHTML("afterbegin", ICONS[name]);
      });
    }
    async function api(path, options = {}) {
      const res = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", "x-intake-token": token, ...(options.headers || {}) }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "request failed");
      return json;
    }
    function setStatus(text) { qs("#status").textContent = text || ""; }
    async function load() {
      if (!token) { setStatus("Missing token"); return; }
      const [summary, items, sources] = await Promise.all([api("/api/summary"), api("/api/items"), api("/api/sources")]);
      state.summary = summary;
      state.items = items.items;
      state.sources = sources.sources;
      renderShell();
      renderCurrent();
    }
    function renderShell() {
      const m = state.summary.counts;
      qs("#metrics").replaceChildren(
        metric(m.items, "Items", "inbox"), metric(m.needs_review, "Review", "shield"), metric(m.high_risk, "High risk", "alert-triangle"), metric(m.actions, "Actions", "bolt")
      );
      const kill = qs("#killSwitch");
      const killLabel = state.summary.settings.auto_actions_enabled ? "Auto-actions on" : "Auto-actions off";
      kill.title = killLabel;
      kill.setAttribute("aria-label", killLabel);
      kill.classList.toggle("on", state.summary.settings.auto_actions_enabled);
      const queues = Object.entries(state.summary.queues).sort((a, b) => b[1] - a[1]);
      qs("#queues").replaceChildren(
        queueButton("", "All queues", state.items.length),
        ...queues.map(([q, n]) => queueButton(q, q, n))
      );
    }
    function metric(value, label, iconName) { return el("div", { class: "metric" }, [icon(iconName), el("b", { text: value }), el("span", { text: label })]); }
    function queueButton(value, label, count) {
      return el("button", { class: "queue-btn" + (state.selectedQueue === value ? " active" : ""), onclick: () => { state.selectedQueue = value; renderCurrent(); renderShell(); } }, [el("span", { text: label }), el("b", { text: count })]);
    }
    function filteredItems() {
      const text = qs("#searchBox").value.toLowerCase();
      const risk = qs("#riskFilter").value;
      const status = qs("#statusFilter").value;
      return state.items.filter((item) =>
        (!state.selectedQueue || item.queue === state.selectedQueue) &&
        (!risk || item.risk_level === risk) &&
        (!status || item.status === status) &&
        (!text || [item.title, item.body, item.normalized_text, (item.tags || []).join(" ")].join(" ").toLowerCase().includes(text))
      );
    }
    function renderCurrent() {
      for (const view of ["items", "sources", "actions", "learnings", "rules", "logs", "settings"]) qs("#" + view + "View").classList.toggle("hidden", state.selectedView !== view);
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === state.selectedView));
      if (state.selectedView === "items") renderItems();
      if (state.selectedView === "sources") renderSources();
      if (state.selectedView === "actions") renderActions();
      if (state.selectedView === "learnings") renderLearnings();
      if (state.selectedView === "rules") renderRules();
      if (state.selectedView === "logs") renderLogs();
      if (state.selectedView === "settings") renderSettings();
    }
    function renderItems() {
      const rows = filteredItems();
      if (rows.length === 0) {
        qs("#itemList").replaceChildren(el("div", { class: "empty-state" }, [
          el("b", { text: "No intake items" }),
          el("div", { class: "muted", text: state.sources.length ? "Sync a source or create a manual item." : "Add an email, file, webhook, or manual source." }),
          el("div", { class: "controls" }, [button("Sources", () => { state.selectedView = "sources"; renderCurrent(); }, "", false, "plug-connected")])
        ]));
        qs("#itemDetail").replaceChildren(el("div", { class: "empty-state" }, [
          el("b", { text: "Nothing selected" }),
          el("div", { class: "muted", text: "Items will appear here after a source sync or manual intake." })
        ]));
        qs("#workSurface").replaceChildren();
        return;
      }
      qs("#itemList").replaceChildren(...rows.map((item) =>
        el("button", { class: "item-row" + (state.selectedItemId === item.id ? " active" : ""), onclick: () => selectItem(item.id) }, [
          el("div", { class: "item-title", text: item.title }),
          el("div", { class: "rowmeta" }, [pill(item.queue), pill(item.status), pill(item.risk_level, item.risk_level), pill(item.source_type)])
        ])
      ));
      if (!state.selectedItemId && rows[0]) selectItem(rows[0].id);
    }
    async function selectItem(id) {
      state.selectedItemId = id;
      const { item } = await api("/api/items/" + encodeURIComponent(id));
      state.selectedItem = item;
      renderDetail();
      renderItems();
    }
    function renderDetail() {
      const item = state.selectedItem;
      if (!item) { qs("#itemDetail").replaceChildren(el("div", { class: "muted", text: "No item selected" })); return; }
      qs("#itemDetail").replaceChildren(
        el("h2", { text: item.title }),
        el("div", { class: "rowmeta" }, [pill(item.queue), pill(item.status), pill(item.risk_level, item.risk_level), pill(item.source_id)]),
        el("div", { class: "grid2" }, [
          info("Author", item.author_email || item.author || "unknown"),
          info("Received", item.received_at || "unknown"),
          info("Category", item.category || "none"),
          info("Intent", item.intent || "none")
        ]),
        el("div", { class: "field" }, [el("b", { text: "Normalized" }), el("div", { class: "bodytext", text: item.normalized_text || item.body || "" })]),
        el("div", { class: "field" }, [el("b", { text: "AI Summary" }), el("div", { class: "bodytext", text: item.ai_summary || "none" })]),
        el("div", { class: "field" }, [el("b", { text: "Tags" }), el("div", { class: "rowmeta" }, (item.tags || []).map((t) => pill(t)))])
      );
      renderWorkSurface(item);
    }
    function renderWorkSurface(item) {
      const draft = el("textarea", { id: "draftBody", placeholder: "Edit a draft before creating an action" });
      const tagInput = el("input", { id: "tagInput", placeholder: "Add tag, e.g. docs-needed" });
      const queueInput = el("input", { id: "queueInput", placeholder: "Move to queue", value: item.queue });
      qs("#workSurface").replaceChildren(
        el("div", { class: "quick-actions" }, [
          iconButton("Classify", () => itemPost(item.id, "classify", {}), "shield"),
          iconButton("Draft", () => itemPost(item.id, "draft", { body: draft.value }), "send"),
          iconButton("Learn", () => itemPost(item.id, "learn", {}), "brain"),
          iconButton("Resolve", () => itemPost(item.id, "resolve", {}), "check", "primary"),
          iconButton("Block", () => itemPost(item.id, "block", {}), "x", "danger")
        ]),
        draft,
        el("div", { class: "work-field" }, [
          el("label", { text: "Move item to queue" }),
          el("div", { class: "formrow" }, [queueInput, button("Move", () => itemPost(item.id, "queue", { queue: queueInput.value }), "", false, "folder")])
        ]),
        el("div", { class: "work-field" }, [
          el("label", { text: "Add tag to item" }),
          el("div", { class: "formrow" }, [tagInput, button("Add", () => itemPost(item.id, "tag", { tag: tagInput.value }), "", false, "tag")])
        ]),
        button("Raw payload", async () => {
          const raw = await api("/api/items/" + encodeURIComponent(item.id) + "/raw");
          qs("#workSurface").append(el("pre", { text: raw.raw || "" }));
        }, "", false, "file-text")
      );
    }
    async function itemPost(id, action, payload) {
      setStatus(action + "...");
      await api("/api/items/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: JSON.stringify(payload) });
      await load();
      await selectItem(id);
      setStatus("Saved");
    }
    async function renderActions() {
      const [{ actions }, audit] = await Promise.all([api("/api/actions?limit=100"), api("/api/approval-audit" + approvalAuditQuery())]);
      const operator = input("auditOperator", state.approvalAuditFilters.operator);
      const actionType = input("auditActionType", state.approvalAuditFilters.action_type);
      const sourceId = input("auditSourceId", state.approvalAuditFilters.source_id);
      const status = input("auditStatus", state.approvalAuditFilters.status);
      const dateFrom = input("auditDateFrom", state.approvalAuditFilters.date_from);
      const dateTo = input("auditDateTo", state.approvalAuditFilters.date_to);
      const auditBlock = el("div", { class: "action-row" }, [
        el("b", { text: "Approval audit" }),
        el("div", { class: "rowmeta" }, [pill("total " + audit.approvals.total)]),
        summaryList("By operator", audit.approvals.by_operator),
        summaryList("By action type", audit.approvals.by_type),
        summaryList("By source", audit.approvals.by_source),
        summaryList("By status", audit.approvals.by_status),
        el("div", { class: "grid2" }, [
          label("Operator", operator),
          label("Action type", actionType),
          label("Source ID", sourceId),
          label("Status", status),
          label("Date from", dateFrom),
          label("Date to", dateTo)
        ]),
        el("div", { class: "controls" }, [
          button("Apply filters", () => {
            state.approvalAuditFilters = {
              operator: operator.value,
              action_type: actionType.value,
              source_id: sourceId.value,
              status: status.value,
              date_from: dateFrom.value,
              date_to: dateTo.value
            };
            renderActions();
          }, "primary", false, "search"),
          button("Clear filters", () => {
            state.approvalAuditFilters = { operator: "", action_type: "", source_id: "", status: "", date_from: "", date_to: "" };
            renderActions();
          }, "", false, "x"),
          button("Export CSV", () => exportApprovalAuditCsv(), "", false, "file-text")
        ])
      ]);
      qs("#actionsList").replaceChildren(auditBlock, ...actions.map((action) =>
        el("div", { class: "action-row" }, [
          el("b", { text: action.type + " · " + action.status }),
          el("div", { class: "muted", text: action.id + " · " + action.intake_item_id }),
          action.type === "send_response" || action.result?.policy_result?.blocked ? el("div", { class: "muted", text: "Direct send is disabled by policy unless you explicitly change the policy gate." }) : "",
          el("pre", { text: action.body || JSON.stringify(action.result || {}, null, 2) }),
          el("div", { class: "controls" }, [
            button("Approve", () => actionPost(action.id, "approve"), "", !["proposed", "needs_review", "blocked"].includes(action.status), "check"),
            button("Reject", () => actionPost(action.id, "reject"), "danger", ["executed", "rejected"].includes(action.status), "x"),
            button("Run", () => actionPost(action.id, "run"), "primary", action.status !== "approved", "player-play")
          ])
        ])
      ));
    }
    function approvalAuditQuery(extra = {}) {
      const params = new URLSearchParams();
      const filters = { ...state.approvalAuditFilters, ...extra };
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
      const text = params.toString();
      return text ? "?" + text : "";
    }
    async function exportApprovalAuditCsv() {
      const audit = await api("/api/approval-audit" + approvalAuditQuery({ format: "csv" }));
      const blob = new Blob([audit.csv || ""], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: "intake-approval-audit.csv" });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("Approval audit CSV exported");
    }
    async function actionPost(id, action) {
      await api("/api/actions/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: "{}" });
      await load();
      renderActions();
    }
    function renderSources() {
      const selected = state.sources.find((source) => source.id === state.selectedSourceId) || state.sources[0] || null;
      state.selectedSourceId = selected ? selected.id : "";
      renderSourceEditor(selected);
      qs("#sourcesList").replaceChildren(
        state.sources.length === 0 ? firstRunSourcesPanel() : sourceSetupGuide(selected),
        ...state.sources.map((source) => {
          const pending = state.pendingSourceAction === source.id;
          return el("div", { class: "source-row" }, [
          el("b", { text: source.name + " · " + source.type }),
          el("div", { class: "rowmeta" }, [
            pill(source.id),
            pill(source.enabled ? "enabled" : "disabled"),
            pill(source.default_queue || "inbox"),
            pill(source.last_test_result ? (source.last_test_result.ok ? "test ok" : "test failed") : "untested"),
            pill(source.last_sync_result ? "sync " + (source.last_sync_result.saved_count || 0) : "not synced")
          ]),
          el("div", { class: "muted", text: source.type === "email" ? (source.config.username || "email account") : JSON.stringify(source.config || {}) }),
          source.last_synced_at ? el("div", { class: "muted", text: "Last sync " + source.last_synced_at + " · saved " + (source.last_sync_result?.saved_count || 0) }) : "",
          el("div", { class: "controls" }, [
            button("Edit", () => { state.selectedSourceId = source.id; renderSources(); }, "", pending, "edit"),
            button(source.enabled ? "Disable" : "Enable", () => sourcePost(source.id, source.enabled ? "disable" : "enable", {}), "", pending, "power"),
            button(pending ? "Working" : "Test", () => sourcePost(source.id, "test", {}), "", pending, "shield"),
            button(pending ? "Working" : "Sync", () => sourcePost(source.id, "sync", {}), "primary", pending, "cloud-download"),
            button("Remove", () => sourcePost(source.id, "remove", {}), "danger", pending, "x")
          ])
        ]);
        })
      );
    }
    function firstRunSourcesPanel() {
      return el("div", { class: "empty-state setup-guide" }, [
        el("b", { text: "First source setup" }),
        el("div", { class: "muted", text: "Pick the source profile, fill the required account or endpoint fields, save it, then run readiness before syncing real intake." }),
        el("div", { class: "preset-grid" }, [
          presetButton("PrivateEmail", "IMAP, SMTP, password env or Keychain", "email", "mail"),
          presetButton("Slack", "Signed Events API receiver", "slack", "plug-connected"),
          presetButton("GitHub", "Signed issue webhooks plus approved comments", "github", "plug"),
          presetButton("Manual", "Local operator-created items", "manual", "plus")
        ]),
        el("div", { class: "setup-steps" }, [
          setupStep("1", "Choose profile", "Select the closest intake source.", "done"),
          setupStep("2", "Store secret", "Use .intake/.env or Keychain. Never paste passwords into config.", state.setupProfile === "manual" ? "done" : "warn"),
          setupStep("3", "Save source", "Create the source record.", "warn"),
          setupStep("4", "Test then sync", "Readiness must pass before live testing.", "warn")
        ])
      ]);
    }
    function presetButton(title, description, profile, iconName) {
      return button("", () => applySourcePreset(profile), "", false, iconName, [
        el("b", { text: title }),
        el("small", { text: description })
      ]);
    }
    function sourcePresetValues(profile) {
      const presets = {
        email: {
          sourceType: "email",
          sourceName: "Support Email",
          sourceId: "support-email",
          sourceQueue: "support",
          sourceUsername: "support@example.com",
          sourcePasswordEnv: "INTAKE_SUPPORT_EMAIL_PASSWORD",
          sourceImapHost: "mail.privateemail.com",
          sourceImapPort: "993",
          sourceMailbox: "INBOX",
          sourceSmtpHost: "mail.privateemail.com",
          sourceSmtpPort: "465",
          sourceFrom: "support@example.com"
        },
        slack: {
          sourceType: "slack",
          sourceName: "Slack Support",
          sourceId: "slack-support",
          sourceQueue: "engineering",
          sourceUsername: "",
          sourcePasswordEnv: "INTAKE_SLACK_SIGNING_SECRET",
          sourceWebhookPath: "/slack/events",
          sourcePort: "8766"
        },
        github: {
          sourceType: "github",
          sourceName: "GitHub Issues",
          sourceId: "github-issues",
          sourceQueue: "engineering",
          sourceUsername: "",
          sourcePasswordEnv: "INTAKE_GITHUB_WEBHOOK_SECRET",
          sourceApiTokenEnv: "INTAKE_GITHUB_API_TOKEN",
          sourceWebhookPath: "/webhook/github",
          sourceRepository: "owner/repo",
          sourcePort: "8765"
        },
        manual: {
          sourceType: "manual",
          sourceName: "Manual",
          sourceId: "manual",
          sourceQueue: "inbox",
          sourceUsername: "",
          sourcePasswordEnv: "",
          sourceWebhookPath: "",
          sourceApiTokenEnv: "",
          sourceRepository: ""
        }
      };
      return presets[profile] || presets.email;
    }
    function applySourcePreset(profile) {
      state.setupProfile = profile;
      renderSources();
      for (const [id, value] of Object.entries(sourcePresetValues(profile))) setControlValue(id, value);
    }
    function setControlValue(id, value) {
      const node = qs("#" + id);
      if (node) node.value = value;
    }
    function sourceSetupGuide(source) {
      if (!source) return firstRunSourcesPanel();
      const hasSecret = source.type === "manual" || source.type === "file" || Boolean(source.secret_ref || source.config?.token);
      const tested = Boolean(source.last_test_result);
      const ready = source.last_test_result?.ok === true;
      const synced = Boolean(source.last_sync_result);
      return el("div", { class: "source-row setup-guide" }, [
        el("b", { text: "Source setup checklist" }),
        el("div", { class: "muted", text: source.name + " is selected. Work left-to-right before sending real traffic into this source." }),
        el("div", { class: "setup-steps" }, [
          setupStep("1", "Saved", source.id, "done"),
          setupStep("2", "Secret", hasSecret ? "Reference configured" : "Add env or Keychain secret", hasSecret ? "done" : "warn"),
          setupStep("3", "Readiness", ready ? "Latest test passed" : (tested ? "Latest test needs attention" : "Run source test"), ready ? "done" : "warn"),
          setupStep("4", "Sync", synced ? "Latest sync recorded" : "Run first sync after readiness", synced ? "done" : "warn")
        ]),
        el("div", { class: "controls" }, [
          button("Edit selected", () => { state.selectedSourceId = source.id; renderSources(); }, "", false, "edit"),
          button("Test readiness", () => sourcePost(source.id, "test", {}), ready ? "" : "primary", false, "shield"),
          button("Sync source", () => sourcePost(source.id, "sync", {}), "", !ready && source.type === "email", "cloud-download"),
          button("Open items", () => { state.selectedView = "items"; renderCurrent(); }, "", false, "inbox")
        ])
      ]);
    }
    function setupStep(number, title, detail, status) {
      return el("div", { class: "setup-step " + (status || "") }, [
        el("div", { class: "rowmeta" }, [pill(number)]),
        el("b", { text: title }),
        el("div", { class: "muted", text: detail })
      ]);
    }
    function renderSourceEditor(source) {
      const defaults = source ? {} : sourcePresetValues(state.setupProfile);
      const type = source?.type || defaults.sourceType || "email";
      const cfg = source?.config || {};
      const imap = cfg.imap || {};
      const smtp = cfg.smtp || {};
      const secret = parseSecretRef(source?.secret_ref || "");
      const quarantine = el("input", { id: "sourceQuarantineAttachments", type: "checkbox" });
      quarantine.checked = cfg.quarantine_attachments === true;
      qs("#sourceEditor").replaceChildren(
        el("div", { class: "source-form" }, [
          label("Type", select("sourceType", ["email", "file", "webhook", "slack", "github", "jira", "linear", "clickup", "manual"], type)),
          label("ID", input("sourceId", source?.id || defaults.sourceId || "support-email", Boolean(source))),
          label("Name", input("sourceName", source?.name || defaults.sourceName || "Support Email")),
          label("Username", input("sourceUsername", cfg.username || defaults.sourceUsername || "")),
          label("Secret storage", select("sourceSecretKind", ["env", "keychain"], secret.kind)),
          label("Password env", input("sourcePasswordEnv", secret.env || defaults.sourcePasswordEnv || "")),
          label("Keychain service", input("sourceKeychainService", secret.service || "kujo-intake")),
          label("Keychain account", input("sourceKeychainAccount", secret.account || cfg.username || "")),
          label("Default queue", input("sourceQueue", source?.default_queue || defaults.sourceQueue || "inbox")),
          label("IMAP host", input("sourceImapHost", imap.host || defaults.sourceImapHost || "mail.privateemail.com")),
          label("IMAP port", input("sourceImapPort", imap.port || defaults.sourceImapPort || 993)),
          label("Mailbox", input("sourceMailbox", cfg.mailbox || defaults.sourceMailbox || "INBOX")),
          label("SMTP host", input("sourceSmtpHost", smtp.host || defaults.sourceSmtpHost || "mail.privateemail.com")),
          label("SMTP port", input("sourceSmtpPort", smtp.port || defaults.sourceSmtpPort || 465)),
          label("From", input("sourceFrom", cfg.from || cfg.username || defaults.sourceFrom || "")),
          label("File path", input("sourcePath", cfg.path || "")),
          label("Webhook port", input("sourcePort", cfg.port || defaults.sourcePort || 8765)),
          label("Webhook path", input("sourceWebhookPath", cfg.path || defaults.sourceWebhookPath || "")),
          label("Workspace URL", input("sourceWorkspaceUrl", cfg.workspace_url || "")),
          label("Provider repo", input("sourceRepository", cfg.repository || defaults.sourceRepository || "")),
          label("API token env", input("sourceApiTokenEnv", parseEnvRef(cfg.api_token_ref || "") || defaults.sourceApiTokenEnv || "")),
          checkboxLabel("Quarantine attachments", quarantine),
          el("div", { class: "controls wide" }, [
            button(source ? "Save source" : "Add source", () => saveSource(source), "", false, source ? "device-floppy" : "plus"),
            button("New email", () => { state.selectedSourceId = ""; renderSourceEditor(null); }, "", false, "mail"),
            source ? button("Test", () => sourcePost(source.id, "test", {}), "", false, "shield") : "",
            source ? button("Sync", () => sourcePost(source.id, "sync", {}), "primary", false, "cloud-download") : ""
          ]),
          source ? renderSourceDiagnostics(source) : ""
        ])
      );
    }
    function input(id, value, disabled = false) {
      const attrs = { id, value: String(value ?? "") };
      if (disabled) attrs.disabled = "disabled";
      return el("input", attrs);
    }
    function select(id, options, value) {
      const node = el("select", { id });
      for (const option of options) {
        const opt = el("option", { value: option, text: option });
        if (option === value) opt.selected = true;
        node.append(opt);
      }
      return node;
    }
    function label(text, control) {
      return el("label", {}, [el("span", { text }), control]);
    }
    function sourcePayload(source) {
      const type = qs("#sourceType").value;
      const pathValue = ["webhook", "slack", "github", "jira", "linear", "clickup"].includes(type) ? qs("#sourceWebhookPath").value : qs("#sourcePath").value;
      return {
        type,
        id: source?.id || qs("#sourceId").value,
        name: qs("#sourceName").value,
        username: qs("#sourceUsername").value,
        secret_kind: qs("#sourceSecretKind").value,
        password_env: qs("#sourcePasswordEnv").value,
        keychain_service: qs("#sourceKeychainService").value,
        keychain_account: qs("#sourceKeychainAccount").value,
        default_queue: qs("#sourceQueue").value,
        imap_host: qs("#sourceImapHost").value,
        imap_port: qs("#sourceImapPort").value,
        mailbox: qs("#sourceMailbox").value,
        smtp_host: qs("#sourceSmtpHost").value,
        smtp_port: qs("#sourceSmtpPort").value,
        from: qs("#sourceFrom").value,
        path: pathValue,
        port: qs("#sourcePort").value,
        workspace_url: qs("#sourceWorkspaceUrl").value,
        repository: qs("#sourceRepository").value,
        api_token_env: qs("#sourceApiTokenEnv").value,
        quarantine_attachments: qs("#sourceQuarantineAttachments").checked
      };
    }
    function parseSecretRef(ref) {
      if (ref.startsWith("keychain:")) {
        const parts = ref.split(":");
        return { kind: "keychain", env: "", service: parts[1] || "kujo-intake", account: parts[2] || "" };
      }
      return { kind: "env", env: ref.replace(/^env:/, ""), service: "kujo-intake", account: "" };
    }
    function parseEnvRef(ref) {
      return String(ref || "").replace(/^env:/, "");
    }
    async function saveSource(source) {
      const payload = sourcePayload(source);
      const path = source ? "/api/sources/" + encodeURIComponent(source.id) + "/update" : "/api/sources";
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      await load();
      state.selectedView = "sources";
      state.selectedSourceId = payload.id;
      renderCurrent();
      setStatus("Source saved");
    }
    async function sourcePost(id, action, payload) {
      try {
        state.pendingSourceAction = id;
        setStatus(action + "...");
        renderSources();
        const result = await api("/api/sources/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: JSON.stringify(payload) });
        if (action === "test") state.sourceDiagnostics[id] = result.result;
        await load();
        state.selectedView = "sources";
        state.selectedSourceId = id;
        setStatus(action === "test" ? sourceTestSummary(result.result) : "Done");
      } finally {
        state.pendingSourceAction = "";
        renderCurrent();
      }
    }
    function renderSourceDiagnostics(source) {
      const result = state.sourceDiagnostics[source.id] || source.last_test_result;
      if (!result) {
        return el("div", { class: "diagnostics" }, [
          el("b", { text: "Readiness" }),
          el("div", { class: "muted", text: "Click Test to verify config, IMAP login, and SMTP login." })
        ]);
      }
      const checks = result.checks || {};
      return el("div", { class: "diagnostics" }, [
        el("b", { text: result.ok ? "Readiness passed" : "Readiness needs attention" }),
        source.last_tested_at ? el("div", { class: "muted", text: "Last tested " + source.last_tested_at }) : "",
        source.last_synced_at ? el("div", { class: "muted", text: "Last synced " + source.last_synced_at + " · saved " + (source.last_sync_result?.saved_count || 0) + " · cursor " + (source.last_sync_result?.cursor || "none") }) : "",
        diagnosticRow("Config", checks.config || { ok: result.ok, errors: result.errors || [] }),
        diagnosticRow("IMAP", checks.imap || { ok: result.ok }),
        diagnosticRow("SMTP", checks.smtp || { ok: result.ok }),
        result.errors?.length ? el("div", { class: "muted", text: result.errors.join(" · ") }) : "",
        source.test_history?.length ? historyBlock("Test history", source.test_history, (row) => (row.ok ? "ok" : "failed") + " · " + row.at) : "",
        source.sync_history?.length ? historyBlock("Sync history", source.sync_history, (row) => (row.ok ? "ok" : "failed") + " · saved " + (row.saved_count || 0) + " · " + row.at) : ""
      ]);
    }
    function diagnosticRow(name, check) {
      const host = [check.host, check.port].filter(Boolean).join(":");
      const detail = check.error || (check.errors || []).join("; ") || host || "ready";
      const statusClass = check.skipped ? "skip" : (check.ok ? "ok" : "fail");
      const statusText = check.skipped ? "SKIP" : (check.ok ? "OK" : "FAIL");
      return el("div", { class: "diagnostic-row" }, [
        el("b", { text: name }),
        el("span", { class: statusClass, text: statusText }),
        el("span", { class: "muted", text: detail })
      ]);
    }
    function sourceTestSummary(result) {
      if (result.ok) return "Source ready: config, IMAP, and SMTP passed";
      return "Source needs attention: " + ((result.errors || []).join("; ") || "test failed");
    }
    async function renderLearnings() {
      const { learnings } = await api("/api/learnings?limit=100");
      qs("#learningsList").replaceChildren(...learnings.map((l) => el("div", { class: "learning-row" }, [el("b", { text: l.title }), el("div", { class: "rowmeta" }, [pill(l.type), pill(l.status), pill(String(l.confidence))]), el("div", { class: "bodytext", text: l.summary })])));
    }
    async function renderRules() {
      const { rules } = await api("/api/rules");
      qs("#rulesList").replaceChildren(...rules.map((r) => el("div", { class: "rule-row" }, [el("b", { text: r.id }), el("div", { class: "rowmeta" }, [pill(r.queue || "none"), pill(r.risk_level || "low")]), el("div", { class: "bodytext", text: r.description || "" })])));
    }
    async function renderLogs() {
      const name = qs("#logSelect").value;
      const { logs } = await api("/api/logs?limit=200&name=" + encodeURIComponent(name));
      qs("#logsList").replaceChildren(...logs.map((log) => el("div", { class: "log-row", text: JSON.stringify(log) })));
    }
    async function renderSettings() {
      const [{ settings }, { policies }, tokenInfo] = await Promise.all([api("/api/settings"), api("/api/policies"), api("/api/dashboard-token")]);
      const auto = el("input", { id: "settingsAuto", type: "checkbox" });
      auto.checked = settings.auto_actions_enabled === true;
      const aiEnabled = el("input", { id: "settingsAiEnabled", type: "checkbox" });
      aiEnabled.checked = settings.ai_enabled === true;
      const provider = input("settingsAiProvider", settings.ai_provider || "none");
      const strata = input("settingsStrata", settings.strata_import_dir || "");
      const recall = input("settingsRecall", settings.totalrecall_export_dir || "");
      const policyText = el("textarea", { id: "policyJson" });
      policyText.value = JSON.stringify(policies, null, 2);
      const previewItem = input("policyPreviewItem", state.selectedItemId || state.items[0]?.id || "");
      const previewAction = input("policyPreviewAction", "draft_response");
      const previewResult = state.policyPreview ? el("pre", { text: JSON.stringify(state.policyPreview, null, 2) }) : el("div", { class: "muted", text: "Run a dry-run to see policy reasons before approving or changing policy." });
      qs("#settingsPanel").replaceChildren(
        el("div", { class: "source-row" }, [
          el("b", { text: "Runtime settings" }),
          el("div", { class: "grid2" }, [
            checkboxLabel("Auto-actions", auto),
            checkboxLabel("AI enabled", aiEnabled),
            label("AI provider", provider),
            label("Strata import dir", strata),
            label("TotalRecall export dir", recall)
          ]),
          el("div", { class: "controls" }, [button("Save settings", async () => {
            await api("/api/settings/update", { method: "POST", body: JSON.stringify({
              auto_actions_enabled: auto.checked,
              ai_enabled: aiEnabled.checked,
              ai_provider: provider.value,
              strata_import_dir: strata.value,
              totalrecall_export_dir: recall.value
            }) });
            await load();
            state.selectedView = "settings";
            setStatus("Settings saved");
          }, "primary", false, "device-floppy")])
        ]),
        el("div", { class: "source-row" }, [
          el("b", { text: "Dashboard token" }),
          el("div", { class: "rowmeta" }, [
            pill("length " + tokenInfo.length),
            pill(tokenInfo.ephemeral ? "runtime token" : "env token"),
            pill(tokenInfo.token || "none")
          ]),
          el("div", { class: "muted", text: "Rotation is in-memory for the active dashboard session. Set INTAKE_DASHBOARD_TOKEN for a stable token on restart." }),
          el("div", { class: "controls" }, [button("Rotate token", async () => {
            const rotated = await api("/api/dashboard-token/rotate", { method: "POST", body: "{}" });
            sessionStorage.setItem("intakeToken", rotated.token);
            history.replaceState(null, "", "/?token=" + encodeURIComponent(rotated.token));
            await load();
            state.selectedView = "settings";
            setStatus("Dashboard token rotated");
          }, "danger", false, "key")])
        ]),
        el("div", { class: "source-row" }, [
          el("b", { text: "Policies" }),
          el("div", { class: "muted", text: "Edit policy JSON carefully. Direct sends remain blocked unless policy explicitly changes." }),
          policyText,
          el("div", { class: "controls" }, [button("Save policies", async () => {
            const parsed = JSON.parse(policyText.value);
            await api("/api/policies", { method: "POST", body: JSON.stringify({ policies: parsed }) });
            await load();
            state.selectedView = "settings";
            setStatus("Policies saved");
          }, "primary", false, "device-floppy")])
        ]),
        el("div", { class: "source-row" }, [
          el("b", { text: "Policy dry-run" }),
          el("div", { class: "grid2" }, [
            label("Item ID", previewItem),
            label("Action type", previewAction)
          ]),
          el("div", { class: "controls" }, [button("Preview policy", async () => {
            state.policyPreview = await api("/api/policy/preview", { method: "POST", body: JSON.stringify({ item_id: previewItem.value, action_type: previewAction.value }) });
            state.selectedView = "settings";
            renderSettings();
            setStatus("Policy preview ready");
          }, "primary", false, "shield")]),
          previewResult
        ])
      );
    }
    function checkboxLabel(text, control) {
      return el("label", { class: "work-field" }, [el("span", { text }), control]);
    }
    function info(label, value) { return el("div", { class: "field" }, [el("b", { text: label }), el("div", { class: "muted", text: value })]); }
    function summaryList(label, values) {
      const entries = Object.entries(values || {});
      return el("div", { class: "field" }, [
        el("b", { text: label }),
        el("div", { class: "rowmeta" }, entries.length ? entries.map(([key, value]) => pill(key + " " + value)) : [pill("none")])
      ]);
    }
    function historyBlock(label, rows, format) {
      return el("div", { class: "field" }, [
        el("b", { text: label }),
        el("div", { class: "stack" }, rows.slice(0, 5).map((row) => el("div", { class: "muted", text: format(row) })))
      ]);
    }
    function pill(text, cls = "") { return el("span", { class: "pill " + cls, text: text || "none" }); }
    function icon(name) {
      const wrap = el("span", { class: "icon-wrap" });
      if (name && ICONS[name]) wrap.innerHTML = ICONS[name];
      return wrap;
    }
    function button(text, onclick, cls = "", disabled = false, iconName = "", children = []) {
      const attrs = { class: cls, text, onclick };
      if (disabled) attrs.disabled = "disabled";
      const btn = el("button", attrs);
      if (iconName && ICONS[iconName]) btn.insertAdjacentHTML("afterbegin", ICONS[iconName]);
      for (const child of children) btn.append(child);
      return btn;
    }
    function iconButton(label, onclick, iconName, cls = "", disabled = false) {
      const attrs = { class: ("icon-btn " + cls).trim(), title: label, "aria-label": label, onclick };
      if (disabled) attrs.disabled = "disabled";
      const btn = el("button", attrs);
      if (iconName && ICONS[iconName]) btn.insertAdjacentHTML("afterbegin", ICONS[iconName]);
      return btn;
    }
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => { state.selectedView = tab.dataset.view; renderCurrent(); }));
    qs("#refreshBtn").addEventListener("click", load);
    qs("#killSwitch").addEventListener("click", async () => { await api("/api/settings/auto-actions", { method: "POST", body: JSON.stringify({ enabled: !state.summary.settings.auto_actions_enabled }) }); await load(); });
    qs("#searchBox").addEventListener("input", renderItems);
    qs("#riskFilter").addEventListener("change", renderItems);
    qs("#statusFilter").addEventListener("change", renderItems);
    qs("#logSelect").addEventListener("change", renderLogs);
    decorateStaticIcons();
    load().catch((error) => setStatus(error.message));
  </script>
</body>
</html>`;
}

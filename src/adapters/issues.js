import { createServer } from "node:http";
import { makeItem } from "../models.js";
import { resolveSecretRef } from "../secrets.js";
import { saveItem, storeRaw, logEvent } from "../storage.js";
import { readStreamText, timingSafeEqualString } from "../util.js";
import { classifyAndSave } from "../workflow.js";

const MAX_ISSUE_BODY_BYTES = 1024 * 1024;
const ISSUE_TYPES = ["github", "jira", "linear", "clickup"];

export function issueCapabilities(provider) {
  return [`receive_${provider}_webhook`, "normalize_issue", "replay"];
}

export function isIssueSourceType(type) {
  return ISSUE_TYPES.includes(type);
}

export function validateIssueConfig(source) {
  const errors = [];
  if (!source.secret_ref && !source.config?.token) errors.push(`missing ${source.type} webhook token or secret_ref`);
  if (source.config?.path && !source.config.path.startsWith("/")) errors.push(`${source.type} webhook path must start with /`);
  return errors;
}

export function testIssueConnection(source) {
  const errors = validateIssueConfig(source);
  return errors.length ? { ok: false, errors } : { ok: true, checks: { config: { ok: true } } };
}

export async function normalizeIssuePayload(root, source, payload) {
  const provider = source.type;
  const normalized = normalizeByProvider(provider, payload);
  const temp = makeItem({
    source_id: source.id,
    source_type: provider,
    source_native_id: normalized.id,
    source_url: normalized.url,
    source_thread_id: normalized.thread_id,
    title: normalized.title,
    body: normalized.body,
    author: normalized.author,
    author_email: normalized.author_email,
    queue: payload.queue || source.default_queue || "inbox",
    tags: [provider, ...normalized.tags],
    received_at: normalized.received_at,
    metadata: {
      issue_provider: provider,
      event_type: normalized.event_type,
      project: normalized.project,
      state: normalized.state
    }
  });
  const rawPath = await storeRaw(root, "webhooks", source.id, temp.id, "json", payload);
  return { ...temp, raw_payload_path: rawPath };
}

export async function startIssueWebhookServer(root, source, options = {}) {
  const port = Number(options.port ?? source.config?.port ?? 8765);
  const path = options.path || source.config?.path || `/webhook/${source.type}`;
  const expectedToken = source.secret_ref ? resolveSecretRef(source.secret_ref, source.id) : source.config?.token;
  if (!expectedToken) throw new Error(`${source.type} source ${source.id} requires a token or env secret_ref`);

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url.split("?")[0] !== path) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-intake-token"] || new URL(req.url, `http://localhost:${port}`).searchParams.get("token");
      if (!timingSafeEqualString(token, expectedToken)) {
        await logEvent(root, "errors", { source_id: source.id, event_type: `${source.type}_auth_failed`, status: "blocked" });
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
      const payload = JSON.parse(await readStreamText(req, { maxBytes: MAX_ISSUE_BODY_BYTES, label: `${source.type} webhook request body` }));
      const item = await normalizeIssuePayload(root, source, payload);
      await saveItem(root, item);
      await classifyAndSave(root, item.id);
      await logEvent(root, "sync", { source_id: source.id, item_id: item.id, event_type: `${source.type}_webhook_received` });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, item_id: item.id }));
    } catch (error) {
      await logEvent(root, "errors", { source_id: source.id, event_type: `${source.type}_webhook_error`, status: "failed", error: error.message });
      res.writeHead(error.statusCode || 400);
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}${path}` };
}

function normalizeByProvider(provider, payload) {
  if (provider === "github") return normalizeGitHub(payload);
  if (provider === "jira") return normalizeJira(payload);
  if (provider === "linear") return normalizeLinear(payload);
  if (provider === "clickup") return normalizeClickUp(payload);
  throw new Error(`unsupported issue provider: ${provider}`);
}

function normalizeGitHub(payload) {
  const issue = payload.issue || payload.pull_request || payload;
  return {
    id: issue.node_id || issue.id || issue.number || payload.id || payload.delivery || null,
    thread_id: issue.number ? String(issue.number) : null,
    title: issue.title || "GitHub issue",
    body: issue.body || payload.comment?.body || JSON.stringify(payload, null, 2),
    url: issue.html_url || payload.repository?.html_url || null,
    author: issue.user?.login || payload.sender?.login || null,
    author_email: null,
    received_at: issue.updated_at || issue.created_at || new Date().toISOString(),
    tags: [payload.action, issue.pull_request ? "pull-request" : "issue"].filter(Boolean),
    event_type: payload.action || "github_event",
    project: payload.repository?.full_name || null,
    state: issue.state || null
  };
}

function normalizeJira(payload) {
  const issue = payload.issue || payload;
  const fields = issue.fields || {};
  return {
    id: issue.key || issue.id || payload.webhookEvent || null,
    thread_id: issue.key || null,
    title: fields.summary || issue.summary || "Jira issue",
    body: jiraText(fields.description || issue.description || JSON.stringify(payload, null, 2)),
    url: issue.self || payload.url || null,
    author: fields.reporter?.displayName || payload.user?.displayName || null,
    author_email: fields.reporter?.emailAddress || payload.user?.emailAddress || null,
    received_at: fields.updated || fields.created || new Date().toISOString(),
    tags: [payload.webhookEvent, fields.issuetype?.name].filter(Boolean),
    event_type: payload.webhookEvent || "jira_event",
    project: fields.project?.key || fields.project?.name || null,
    state: fields.status?.name || null
  };
}

function normalizeLinear(payload) {
  const issue = payload.data || payload.issue || payload;
  return {
    id: issue.id || issue.identifier || payload.id || null,
    thread_id: issue.identifier || issue.id || null,
    title: issue.title || "Linear issue",
    body: issue.description || JSON.stringify(payload, null, 2),
    url: issue.url || null,
    author: issue.creator?.name || issue.assignee?.name || null,
    author_email: issue.creator?.email || null,
    received_at: issue.updatedAt || issue.createdAt || new Date().toISOString(),
    tags: [payload.action, issue.team?.key].filter(Boolean),
    event_type: payload.action || payload.type || "linear_event",
    project: issue.team?.name || issue.project?.name || null,
    state: issue.state?.name || null
  };
}

function normalizeClickUp(payload) {
  const task = payload.task || payload;
  return {
    id: task.id || payload.task_id || payload.id || null,
    thread_id: task.id || payload.task_id || null,
    title: task.name || "ClickUp task",
    body: task.text_content || task.description || JSON.stringify(payload, null, 2),
    url: task.url || payload.url || null,
    author: task.creator?.username || task.creator?.email || null,
    author_email: task.creator?.email || null,
    received_at: task.date_updated ? dateFromClickUp(task.date_updated) : new Date().toISOString(),
    tags: [payload.event, task.status?.status].filter(Boolean),
    event_type: payload.event || "clickup_event",
    project: task.project?.name || task.list?.name || null,
    state: task.status?.status || null
  };
}

function jiraText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function dateFromClickUp(value) {
  const ms = Number(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

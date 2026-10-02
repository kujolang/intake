import { withStoreLock } from "../store-lock.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { makeItem } from "../models.js";
import { resolveSecretRef } from "../secrets.js";
import { saveItem, storeRaw, logEvent } from "../storage.js";
import { readStreamText } from "../util.js";
import { classifyAndSave } from "../workflow.js";
import { recordRequestError, requestErrorPayload } from "../request-errors.js";

const MAX_SLACK_BODY_BYTES = 1024 * 1024;
const MAX_SIGNATURE_SKEW_SECONDS = 60 * 5;

export function slackCapabilities() {
  return ["receive_slack_events", "url_verification", "signed_requests"];
}

export function validateSlackConfig(source) {
  const errors = [];
  if (!source.secret_ref && !source.config?.signing_secret) errors.push("missing Slack signing secret_ref");
  if (source.config?.path && !source.config.path.startsWith("/")) errors.push("Slack webhook path must start with /");
  return errors;
}

export function testSlackConnection(source) {
  const errors = validateSlackConfig(source);
  return errors.length ? { ok: false, errors } : { ok: true, checks: { config: { ok: true } } };
}

export async function normalizeSlackPayload(root, source, payload) {
  const event = payload.event || payload;
  const title = slackTitle(event);
  const body = event.text || payload.text || JSON.stringify(payload, null, 2);
  const temp = makeItem({
    source_id: source.id,
    source_type: "slack",
    source_native_id: event.client_msg_id || payload.event_id || event.event_ts || event.ts || null,
    source_thread_id: event.thread_ts || event.ts || payload.event_id || null,
    source_url: slackPermalink(source, event),
    title,
    body,
    author: event.user || event.username || payload.author || null,
    author_id: event.user || null,
    participants: [event.user, event.bot_id].filter(Boolean),
    queue: source.default_queue || "inbox",
    tags: ["slack"],
    received_at: slackTimestamp(event.event_ts || event.ts) || new Date().toISOString(),
    metadata: {
      slack_payload: true,
      team_id: payload.team_id || payload.authorizations?.[0]?.team_id || null,
      channel: event.channel || payload.channel || null,
      event_type: event.type || payload.type || null
    }
  });
  const rawPath = await storeRaw(root, "webhooks", source.id, temp.id, "json", payload);
  return { ...temp, raw_payload_path: rawPath };
}

export async function startSlackServer(root, source, options = {}) {
  const port = Number(options.port ?? source.config?.port ?? 8766);
  const path = options.path || source.config?.path || `/slack/${source.id}`;
  const signingSecret = source.secret_ref ? resolveSecretRef(source.secret_ref, source.id) : source.config?.signing_secret;
  if (!signingSecret) throw new Error(`Slack source ${source.id} requires a signing secret_ref`);

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url.split("?")[0] !== path) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const raw = await readStreamText(req, { maxBytes: MAX_SLACK_BODY_BYTES, label: "Slack request body" });
      if (!verifySlackSignature(req, raw, signingSecret)) {
        await recordRequestError(root, { source_id: source.id, event_type: "slack_auth_failed", status: "blocked" });
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
      const payload = JSON.parse(raw);
      if (payload.type === "url_verification") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(payload.challenge || "");
        return;
      }
      const item = await withStoreLock(root, async () => {
        const item = await normalizeSlackPayload(root, source, payload);
        await saveItem(root, item);
        await classifyAndSave(root, item.id);
        await logEvent(root, "sync", { source_id: source.id, item_id: item.id, event_type: "slack_event_received" });
        return item;
      });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, item_id: item.id }));
    } catch (error) {
      const logged = await recordRequestError(root, { source_id: source.id, event_type: "slack_error", status: "failed", error: error.message });
      res.writeHead(error.statusCode || 400);
      res.end(JSON.stringify(requestErrorPayload(error, logged, { includeOk: true })));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}${path}` };
}

export function signSlackTestBody(body, signingSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const base = `v0:${timestamp}:${body}`;
  const digest = createHmac("sha256", signingSecret).update(base).digest("hex");
  return { timestamp: String(timestamp), signature: `v0=${digest}` };
}

function verifySlackSignature(req, raw, signingSecret) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(skew) || skew > MAX_SIGNATURE_SKEW_SECONDS) return false;
  const expected = signSlackTestBody(raw, signingSecret, timestamp).signature;
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function slackTitle(event) {
  const prefix = event.channel ? `Slack ${event.channel}` : "Slack event";
  const text = String(event.text || event.type || "").replace(/\s+/g, " ").trim();
  return text ? `${prefix}: ${text.slice(0, 80)}` : prefix;
}

function slackTimestamp(value) {
  const seconds = Number(String(value || "").split(".")[0]);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function slackPermalink(source, event) {
  const workspace = source.config?.workspace_url;
  if (!workspace || !event.channel || !event.ts) return null;
  return `${workspace.replace(/\/$/, "")}/archives/${event.channel}/p${String(event.ts).replace(".", "")}`;
}

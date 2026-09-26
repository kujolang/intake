import { createServer } from "node:http";
import { makeItem } from "../models.js";
import { resolveSecretRef } from "../secrets.js";
import { saveItem, storeRaw, logEvent } from "../storage.js";
import { readStreamText, timingSafeEqualString } from "../util.js";
import { classifyAndSave } from "../workflow.js";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export function webhookCapabilities() {
  return ["receive_json", "replay"];
}

export async function normalizeWebhookPayload(root, source, payload) {
  const title = valueAt(payload, source.config?.mapping?.title) || payload.title || payload.subject || payload.event || "Webhook event";
  const body =
    valueAt(payload, source.config?.mapping?.body) ||
    payload.body ||
    payload.text ||
    payload.description ||
    JSON.stringify(payload, null, 2);
  const temp = makeItem({
    source_id: source.id,
    source_type: payload.source_type || source.config?.source_type || "webhook",
    source_native_id: payload.id || payload.event_id || null,
    source_url: payload.url || payload.html_url || null,
    title,
    body,
    author: payload.author || payload.sender || payload.user || null,
    author_email: payload.author_email || payload.email || null,
    participants: payload.participants || [],
    queue: payload.queue || source.default_queue || "inbox",
    tags: payload.tags || [],
    metadata: { webhook_payload: true }
  });
  const rawPath = await storeRaw(root, "webhooks", source.id, temp.id, "json", payload);
  return { ...temp, raw_payload_path: rawPath };
}

export async function startWebhookServer(root, source, options = {}) {
  const port = Number(options.port ?? source.config?.port ?? 8765);
  const path = options.path || source.config?.path || `/webhook/${source.id}`;
  const expectedToken = source.secret_ref ? resolveSecretRef(source.secret_ref, source.id) : source.config?.token;
  if (!expectedToken) throw new Error(`webhook source ${source.id} requires a token or env secret_ref`);

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url.split("?")[0] !== path) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || new URL(req.url, `http://localhost:${port}`).searchParams.get("token");
      if (!timingSafeEqualString(token, expectedToken)) {
        await logEvent(root, "errors", { source_id: source.id, event_type: "webhook_auth_failed", status: "blocked" });
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
      const payload = JSON.parse(await readStreamText(req, { maxBytes: MAX_WEBHOOK_BODY_BYTES, label: "webhook request body" }));
      const item = await normalizeWebhookPayload(root, source, payload);
      await saveItem(root, item);
      await classifyAndSave(root, item.id);
      await logEvent(root, "sync", { source_id: source.id, item_id: item.id, event_type: "webhook_received" });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, item_id: item.id }));
    } catch (error) {
      await logEvent(root, "errors", { source_id: source.id, event_type: "webhook_error", status: "failed", error: error.message });
      res.writeHead(error.statusCode || 400);
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}${path}` };
}

function valueAt(obj, dotted) {
  if (!dotted) return null;
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur ?? null;
}

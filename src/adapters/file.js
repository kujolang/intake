import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { simpleParser } from "mailparser";
import { attachmentMetadata } from "../attachments.js";
import { makeItem } from "../models.js";
import { storeRaw } from "../storage.js";
import { shortHash } from "../util.js";

const SUPPORTED = new Set([".txt", ".md", ".json", ".eml"]);

export function fileCapabilities() {
  return ["sync_since"];
}

export async function syncFileSource(root, source) {
  const folder = source.config?.path;
  if (!folder) throw new Error(`file source ${source.id} is missing config.path`);
  const names = await readdir(folder);
  const seen = new Set(source.cursor?.seen || []);
  const items = [];

  for (const name of names.sort()) {
    const path = join(folder, name);
    const info = await stat(path);
    if (!info.isFile()) continue;
    const ext = extname(name).toLowerCase();
    if (!SUPPORTED.has(ext)) continue;
    const nativeId = `${name}:${info.mtimeMs}:${info.size}`;
    if (seen.has(nativeId)) continue;
    const buffer = await readFile(path);
    const rawId = shortHash(nativeId, 16);
    let item;
    if (ext === ".eml") {
      item = await itemFromEml(root, source, rawId, nativeId, buffer);
    } else if (ext === ".json") {
      item = await itemFromJson(root, source, rawId, nativeId, buffer, name);
    } else {
      item = await itemFromText(root, source, rawId, nativeId, buffer, name);
    }
    items.push(item);
    seen.add(nativeId);
  }

  return { items, cursor: { seen: [...seen].slice(-5000), synced_at: new Date().toISOString() } };
}

async function itemFromText(root, source, rawId, nativeId, buffer, name) {
  const text = buffer.toString("utf8");
  const temp = makeItem({
    source_id: source.id,
    source_type: "file",
    source_native_id: nativeId,
    title: firstLine(text) || name,
    body: text,
    queue: source.default_queue || "inbox",
    metadata: { file_name: name }
  });
  const rawPath = await storeRaw(root, "files", source.id, temp.id, "txt", text);
  return { ...temp, raw_payload_path: rawPath };
}

async function itemFromJson(root, source, rawId, nativeId, buffer, name) {
  const payload = JSON.parse(buffer.toString("utf8"));
  const title = payload.title || payload.subject || payload.name || name;
  const body = payload.body || payload.text || payload.description || JSON.stringify(payload, null, 2);
  const temp = makeItem({
    source_id: source.id,
    source_type: payload.source_type || "file",
    source_native_id: payload.id || nativeId,
    source_url: payload.url || null,
    title,
    body,
    author: payload.author || payload.sender || null,
    author_email: payload.author_email || payload.email || null,
    participants: payload.participants || [],
    queue: payload.queue || source.default_queue || "inbox",
    tags: payload.tags || [],
    metadata: { file_name: name, json_payload: true }
  });
  const rawPath = await storeRaw(root, "files", source.id, temp.id, "json", payload);
  return { ...temp, raw_payload_path: rawPath };
}

async function itemFromEml(root, source, rawId, nativeId, buffer) {
  const parsed = await simpleParser(buffer);
  const temp = makeItem({
    source_id: source.id,
    source_type: "email",
    source_native_id: parsed.messageId || nativeId,
    source_thread_id: parsed.inReplyTo || parsed.references?.[0] || parsed.messageId || nativeId,
    title: parsed.subject || "(no subject)",
    body: parsed.text || parsed.html || "",
    author: parsed.from?.text || null,
    author_email: parsed.from?.value?.[0]?.address || null,
    participants: [...(parsed.to?.value || []), ...(parsed.cc?.value || [])].map((entry) => entry.address || entry.name).filter(Boolean),
    received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    attachments: [],
    queue: source.default_queue || "inbox",
    metadata: { email_headers: Object.fromEntries(parsed.headers || []) }
  });
  const attachments = await attachmentMetadata(root, source, temp.id, parsed.attachments || []);
  const rawPath = await storeRaw(root, "email", source.id, temp.id, "eml", buffer.toString("utf8"));
  return { ...temp, attachments, raw_payload_path: rawPath };
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { attachmentMetadata } from "../attachments.js";
import { makeItem } from "../models.js";
import { resolveSecretRef } from "../secrets.js";
import { storeRaw } from "../storage.js";

const DEFAULT_TEST_TIMEOUT_MS = 15000;

export function emailCapabilities() {
  return ["sync_since", "send_response", "append_remote_draft", "append_remote_sent", "mark_remote_read"];
}

export function validateEmailConfig(source) {
  const config = source.config || {};
  const errors = [];
  if (!config.username) errors.push("missing email username");
  if (config.secure === false) errors.push("insecure email connections are blocked by default");
  if (config.imap?.secure === false || config.smtp?.secure === false) errors.push("insecure IMAP/SMTP config is blocked by default");
  return errors;
}

export async function testEmailConnection(source) {
  const errors = validateEmailConfig(source);
  const result = {
    ok: false,
    checks: {
      config: { ok: errors.length === 0, errors },
      imap: { ok: false, skipped: false },
      smtp: { ok: false, skipped: false }
    },
    errors: [...errors]
  };
  if (errors.length) {
    result.checks.imap = { ok: false, skipped: true, error: "skipped until config passes" };
    result.checks.smtp = { ok: false, skipped: true, error: "skipped until config passes" };
    return result;
  }

  result.checks.imap = await checkImap(source);
  if (!result.checks.imap.ok) result.errors.push(`imap: ${result.checks.imap.error}`);

  result.checks.smtp = await checkSmtp(source);
  if (!result.checks.smtp.ok) result.errors.push(`smtp: ${result.checks.smtp.error}`);

  result.ok = result.checks.config.ok && result.checks.imap.ok && result.checks.smtp.ok;
  return result;
}

export async function syncEmailSource(root, source) {
  const client = await openImap(source);
  const mailbox = source.config?.mailbox || "INBOX";
  const lock = await client.getMailboxLock(mailbox);
  const items = [];
  let maxUid = Number(source.cursor?.uid || 0);
  try {
    const query = nextUidRange(source, client.mailbox);
    if (!query) {
      return { items, cursor: { uid: maxUid, synced_at: new Date().toISOString() } };
    }
    for await (const message of client.fetch(query, { uid: true, envelope: true, source: true, flags: true }, { uid: true })) {
      if (!message.uid || message.uid <= maxUid) continue;
      maxUid = Math.max(maxUid, message.uid);
      const item = await itemFromMessage(root, source, message);
      items.push(item);
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { items, cursor: { uid: maxUid, synced_at: new Date().toISOString() } };
}

export async function sendEmailResponse(source, action, item) {
  const transporter = nodemailer.createTransport(smtpConfig(source));
  const from = headerValue(source.config?.from || source.config?.username);
  const to = headerValue(item.author_email);
  if (!to) throw new Error("cannot send email response without item.author_email");
  try {
    const result = await transporter.sendMail({
      from,
      to,
      subject: headerValue(action.metadata?.subject || `Re: ${item.title}`),
      text: action.body,
      inReplyTo: item.source_native_id ? headerValue(item.source_native_id) : undefined,
      references: item.source_thread_id ? headerValue(item.source_thread_id) : undefined
    });
    return { message_id: result.messageId, accepted: result.accepted, rejected: result.rejected };
  } finally {
    transporter.close();
  }
}

export async function appendEmailDraft(source, action, item) {
  const client = await openImap(source);
  const mailbox = source.config?.drafts_mailbox || "Drafts";
  const raw = [
    `From: ${headerValue(source.config?.from || source.config?.username)}`,
    `To: ${headerValue(item.author_email || "")}`,
    `Subject: ${headerValue(action.metadata?.subject || `Re: ${item.title}`)}`,
    item.source_native_id ? `In-Reply-To: ${headerValue(item.source_native_id)}` : null,
    "",
    action.body
  ].filter((line) => line !== null).join("\r\n");
  try {
    await client.append(mailbox, Buffer.from(raw), ["\\Draft"]);
    return { appended_to: mailbox };
  } finally {
    await client.logout();
  }
}

async function itemFromMessage(root, source, message) {
  const parsed = await simpleParser(message.source);
  const temp = makeItem({
    source_id: source.id,
    source_type: "email",
    source_native_id: parsed.messageId || String(message.uid),
    source_thread_id: parsed.inReplyTo || parsed.references?.[0] || parsed.messageId || String(message.uid),
    title: parsed.subject || "(no subject)",
    body: parsed.text || parsed.html || "",
    author: parsed.from?.text || null,
    author_email: parsed.from?.value?.[0]?.address || null,
    participants: [...(parsed.to?.value || []), ...(parsed.cc?.value || [])].map((entry) => entry.address || entry.name).filter(Boolean),
    received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    attachments: [],
    queue: source.default_queue || "inbox",
    metadata: {
      uid: message.uid,
      flags: [...(message.flags || [])],
      email_headers: Object.fromEntries(parsed.headers || [])
    }
  });
  const attachments = await attachmentMetadata(root, source, temp.id, parsed.attachments || []);
  const rawPath = await storeRaw(root, "email", source.id, temp.id, "eml", message.source.toString("utf8"));
  return { ...temp, attachments, raw_payload_path: rawPath };
}

async function openImap(source) {
  const client = new ImapFlow(imapConfig(source));
  client.on("error", () => {});
  await client.connect();
  return client;
}

async function checkImap(source) {
  let client;
  try {
    client = await openImap(source);
    return { ok: true, host: imapHost(source), port: imapPort(source) };
  } catch (error) {
    return { ok: false, host: imapHost(source), port: imapPort(source), error: providerErrorMessage(error, source) };
  } finally {
    if (client) await client.logout().catch(() => {});
  }
}

async function checkSmtp(source) {
  let transporter;
  try {
    transporter = nodemailer.createTransport(smtpConfig(source));
    await transporter.verify();
    return { ok: true, host: smtpHost(source), port: smtpPort(source) };
  } catch (error) {
    return { ok: false, host: smtpHost(source), port: smtpPort(source), error: providerErrorMessage(error, source) };
  } finally {
    if (transporter) transporter.close();
  }
}

function imapConfig(source) {
  const config = source.config || {};
  return {
    host: imapHost(source),
    port: imapPort(source),
    secure: imapSecure(source),
    auth: {
      user: config.username,
      pass: secretValue(source)
    },
    connectionTimeout: testTimeoutMs(source),
    greetingTimeout: testTimeoutMs(source),
    socketTimeout: testTimeoutMs(source),
    logger: false
  };
}

function smtpConfig(source) {
  const config = source.config || {};
  if (!smtpSecure(source)) throw new Error("insecure SMTP config is blocked by default");
  return {
    host: smtpHost(source),
    port: smtpPort(source),
    secure: smtpSecure(source),
    auth: {
      user: config.username,
      pass: secretValue(source)
    },
    connectionTimeout: testTimeoutMs(source),
    greetingTimeout: testTimeoutMs(source),
    socketTimeout: testTimeoutMs(source)
  };
}

function secretValue(source) {
  return resolveSecretRef(source.secret_ref, source.id);
}

function imapHost(source) {
  return source.config?.imap?.host || "mail.privateemail.com";
}

function imapPort(source) {
  return Number(source.config?.imap?.port || 993);
}

function imapSecure(source) {
  return source.config?.imap?.secure !== false;
}

function smtpHost(source) {
  return source.config?.smtp?.host || "mail.privateemail.com";
}

function smtpPort(source) {
  return Number(source.config?.smtp?.port || 465);
}

function smtpSecure(source) {
  return source.config?.smtp?.secure !== false;
}

function testTimeoutMs(source) {
  const value = Number(source.config?.test_timeout_ms || DEFAULT_TEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TEST_TIMEOUT_MS;
}

function headerValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

export function nextUidRange(source, mailbox = {}) {
  const cursorUid = Number(source.cursor?.uid || 0);
  const uidNext = Number(mailbox.uidNext || 0);
  if (Number.isFinite(uidNext) && uidNext > 0 && cursorUid >= uidNext - 1) return null;
  return cursorUid > 0 ? `${cursorUid + 1}:*` : "1:*";
}

function providerErrorMessage(error, source) {
  const parts = [
    error?.response,
    error?.message,
    error?.code,
    error?.serverResponseCode
  ].filter(Boolean);
  const message = parts.length ? parts.join(" | ") : "connection failed";
  return redactProviderError(message, source);
}

function redactProviderError(message, source) {
  let out = String(message || "");
  const username = source.config?.username;
  if (username) out = out.split(username).join("[EMAIL]");
  return out;
}

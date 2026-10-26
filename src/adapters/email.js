import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { sha256, stableStringify } from "../util.js";
import { resourceLimit } from "../resource-limits.js";
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
  const maxBytes = resourceLimit(source.config?.max_message_bytes, 25 * 1024 * 1024, "max_message_bytes");
  const maxBatchBytes = resourceLimit(source.config?.max_batch_bytes, 64 * 1024 * 1024, "max_batch_bytes");
  const maxBatchItems = resourceLimit(source.config?.max_batch_items, 1000, "max_batch_items");
  let batchBytes = 0;
  const client = await openImap(source);
  const mailbox = source.config?.mailbox || "INBOX";
  let lock;
  let stopEarly = false;
  const items = [];
  let maxUid = Number(source.cursor?.uid || 0);
  try {
    lock = await client.getMailboxLock(mailbox);
    const query = nextUidRange(source, client.mailbox);
    if (!query) {
      return { items, cursor: { uid: maxUid, synced_at: new Date().toISOString() } };
    }
    for await (const message of client.fetch(query, { uid: true, envelope: true, source: { start: 0, maxLength: maxBytes + 1 }, flags: true }, { uid: true })) {
      if (items.length >= maxBatchItems) { stopEarly = true; break; }
      if (!message.uid || message.uid <= maxUid) continue;
      if (!message.source || message.source.length > maxBytes) throw new Error(`message exceeds max_message_bytes (${maxBytes}); cursor preserved`);
      if (batchBytes + message.source.length > maxBatchBytes) {
        if (!items.length) throw new Error("message exceeds max_batch_bytes; cursor preserved");
        stopEarly = true;
        break;
      }
      batchBytes += message.source.length;
      maxUid = Math.max(maxUid, message.uid);
      const item = await itemFromMessage(root, source, message);
      items.push(item);
    }
  } catch (error) {
    stopEarly = true;
    throw error;
  } finally {
    lock?.release();
    // A terminated fetch otherwise drains the remaining mailbox before LOGOUT.
    if (stopEarly) client.close();
    else await client.logout().catch(() => client.close());
  }
  return { items, cursor: { uid: maxUid, synced_at: new Date().toISOString() } };
}

export async function sendEmailResponse(source, action, item) {
  if (action.metadata?.outreach || item.metadata?.outreach) throw new Error("outreach delivery is disabled; campaign drafts cannot be sent");
  const from = headerValue(source.config?.from || source.config?.username);
  const to = headerValue(action.metadata?.to || item.author_email);
  if (!to) throw new Error("cannot send email response without item.author_email");
  const transporter = nodemailer.createTransport(smtpConfig(source));
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
  if (action.metadata?.outreach?.holds?.length || item.metadata?.outreach?.holds?.length) throw new Error("outreach draft is held for review");
  const mailbox = source.config?.drafts_mailbox || "Drafts";
  const raw = [
    `From: ${headerValue(source.config?.from || source.config?.username)}`,
    `To: ${headerValue(action.metadata?.to || item.author_email || "")}`,
    `Subject: ${headerValue(action.metadata?.subject || `Re: ${item.title}`)}`,
    action.metadata?.draft_message_id ? `Message-ID: ${headerValue(action.metadata.draft_message_id)}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    item.source_native_id ? `In-Reply-To: ${headerValue(item.source_native_id)}` : null,
    "",
    action.body
  ].filter((line) => line !== null).join("\r\n");
  const client = await openImap(source);
  let appendError;
  try {
    const receipt = await client.append(mailbox, Buffer.from(raw), ["\\Draft"]);
    return { appended_to: mailbox, uid: receipt?.uid ? String(receipt.uid) : null, uid_validity: receipt?.uidValidity ? String(receipt.uidValidity) : null, message_id: action.metadata?.draft_message_id || null };
  } catch (error) {
    appendError = error;
    throw error;
  } finally {
    try { await client.logout(); }
    catch (error) {
      client.close();
      // Keep the failed external operation authoritative; do not mask its cause.
      if (!appendError) throw error;
    }
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
  const errors = validateEmailConfig(source);
  if (errors.length) throw new Error(errors.join("; "));
  const client = new ImapFlow(imapConfig(source));
  client.on("error", () => {});
  try {
    await client.connect();
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

async function checkImap(source) {
  let client;
  try {
    client = await openImap(source);
    return { ok: true, host: imapHost(source), port: imapPort(source) };
  } catch (error) {
    return { ok: false, host: imapHost(source), port: imapPort(source), error: providerErrorMessage(error, source) };
  } finally {
    if (client) await client.logout().catch(() => client.close());
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

// Read-only mailbox-wide history. No message contents or unrelated envelopes leave
// the adapter. Any failed folder scan fails the entire preflight closed.
export async function inspectEmailHistory(source, terms) {
  if (!Array.isArray(terms) || !terms.length || terms.some(t => typeof t !== "string" || t.trim().length < 4)) throw new Error("history requires specific identity terms");
  const client = await openImap(source);
  const folders = [];
  const matches = [];
  try {
    for (const folder of await client.list()) {
      if (folder.flags?.has("\\Noselect")) continue;
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        const found = new Set();
        for (const term of terms) for (const uid of (await client.search({ text: term }, { uid: true }) || [])) found.add(uid);
        folders.push({ mailbox: folder.path, matched_messages: found.size });
        for (const uid of found) matches.push({ mailbox: folder.path, uid: String(uid) });
      } finally { lock.release(); }
    }
    return { checked_at: new Date().toISOString(), complete: true, source_id: source.id, folders, matches };
  } finally { await client.logout().catch(() => client.close()); }
}

// Verify a known draft without marking it read or exporting mailbox content.
export async function verifyEmailDraft(source, action, item) {
  const messageId = action.metadata?.draft_message_id;
  if (!messageId) throw new Error('draft Message-ID required');
  const client = await openImap(source);
  let lock;
  try {
    lock = await client.getMailboxLock(source.config?.drafts_mailbox || 'Drafts', { readOnly: true });
    const uids = await client.search({ header: { 'Message-ID': messageId } }, { uid: true });
    if (uids.length !== 1) return { ok: false, copies: uids.length };
    const message = await client.fetchOne(uids[0], { source: true, flags: true }, { uid: true });
    const parsed = await simpleParser(message.source);
    const checks = {
      draft_flag: message.flags.has('\\Draft'),
      recipient: parsed.to?.value?.length === 1 && parsed.to.value[0].address.toLowerCase() === item.author_email.toLowerCase(),
      sender: parsed.from?.value?.[0]?.address.toLowerCase() === source.config.username.toLowerCase(),
      subject: parsed.subject === action.metadata.subject,
      body: parsed.text?.replace(/\r\n/g, '\n').trim() === action.body.replace(/\r\n/g, '\n').trim()
    };
    return { ok: Object.values(checks).every(Boolean), copies: 1, uid: String(uids[0]), message_id: messageId, checks };
  } finally { lock?.release();await client.logout().catch(() => client.close()); }
}

// IMAP bodies are immutable. Verify the old copy, append/read back the new one,
// then move only the old UID into a recoverable archive. Never use SMTP.
export async function replaceEmailDraft(source, previous, next, item) {
  if (previous.type !== 'draft_response' || next.type !== 'draft_response' || next.metadata?.outreach?.mode !== 'DRAFT') throw new Error('only draft replacement is supported');
  if (next.metadata?.outreach?.holds?.length || item.metadata?.outreach?.holds?.length) throw new Error('held draft cannot be replaced remotely');
  const oldId=previous.metadata?.draft_message_id, newId=next.metadata?.draft_message_id;
  if(!oldId || !newId || oldId===newId) throw new Error('distinct versioned Message-IDs required');
  const client=await openImap(source);let lock;
  const mailbox=source.config?.drafts_mailbox || 'Drafts', archive='Archive/Outreach Revisions';
  const raw=[`From: ${headerValue(source.config?.from || source.config?.username)}`,`To: ${headerValue(item.author_email)}`,`Subject: ${headerValue(next.metadata.subject)}`,`Message-ID: ${headerValue(newId)}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',next.body].join('\r\n');
  const matches=async id=>await client.search({header:{'Message-ID':id}},{uid:true}) || [];
  const check=async (uid,action)=>{
    const m=await client.fetchOne(uid,{source:true,flags:true},{uid:true});const p=await simpleParser(m.source);
    if(!m.flags.has('\\Draft') || p.subject!==action.metadata.subject || p.text?.replace(/\r\n/g,'\n').trim()!==action.body.replace(/\r\n/g,'\n').trim() || p.to?.value?.length!==1 || p.to.value[0].address.toLowerCase()!==item.author_email.toLowerCase() || p.from?.value?.[0]?.address.toLowerCase()!==source.config.username.toLowerCase()) throw new Error('draft changed or readback failed; reconcile before retry');
  };
  try{
    if(!(await client.list()).some(f=>f.path===archive)) await client.mailboxCreate(archive);
    lock=await client.getMailboxLock(mailbox);
    const old=await matches(oldId), newer=await matches(newId);
    if(old.length!==1 || newer.length) throw new Error('unexpected draft versions; reconcile before retry');
    await check(old[0],previous);
    const receipt=await client.append(mailbox,Buffer.from(raw),['\\Draft']);
    const added=await matches(newId);if(added.length!==1) throw new Error('replacement append uncertain; reconcile before retry');
    await check(added[0],next);
    const moved=await client.messageMove(old[0],archive,{uid:true});
    if(!moved || (await matches(oldId)).length || (await matches(newId)).length!==1) throw new Error('revision archive uncertain; reconcile before retry');
    return {appended_to:mailbox,uid:String(added[0]),uid_validity:receipt?.uidValidity ? String(receipt.uidValidity) : null,message_id:newId,replaced_uid:String(old[0]),previous_message_id:oldId,archived_to:archive,archived_uid:moved.uidMap?.get(old[0]) ? String(moved.uidMap.get(old[0])) : null,verified:true};
  }finally{lock?.release();await client.logout().catch(()=>client.close());}
}

// Bind separate operator authorization to the precise existing draft and sender.
export function outreachDeliveryFingerprint(source, action, item) {
  return sha256(stableStringify({ source_id: source.id, from: source.config.from || source.config.username, username: source.config.username, action_id: action.id, item_id: item.id, to: item.author_email, subject: action.metadata?.subject, body: action.body, message_id: action.metadata?.draft_message_id }));
}

export async function deliverApprovedOutreach(source, action, item, fingerprint, recordReceipt) {
  if (!fingerprint || fingerprint !== outreachDeliveryFingerprint(source, action, item) || typeof recordReceipt !== 'function' || action.type !== 'draft_response' || !action.metadata?.outreach || action.metadata.outreach.holds?.length || item.metadata?.outreach?.holds?.length || !item.author_email) throw new Error('exact approved outreach draft required');
  const verified = await verifyEmailDraft(source, action, item);
  if (!verified.ok) throw new Error('draft changed before submission');
  const messageId = action.metadata.draft_message_id;
  const raw = await new MailComposer({ from: source.config.from || source.config.username, to: item.author_email, subject: action.metadata.subject, text: action.body, messageId, date: new Date() }).compile().build();
  const client = await openImap(source);
  const sent = source.config.sent_mailbox || 'Sent', drafts = source.config.drafts_mailbox || 'Drafts', archive = 'Archive/Outreach Sent Drafts';
  let lock, transporter;
  const matches = async () => await client.search({ header: { 'Message-ID': messageId } }, { uid: true }) || [];
  try {
    lock = await client.getMailboxLock(sent);
    if ((await matches()).length) throw new Error('Sent already contains this message; do not resend');
    lock.release(); lock = null;
    transporter = nodemailer.createTransport(smtpConfig(source));
    const result = await transporter.sendMail({ envelope: { from: source.config.username, to: [item.author_email] }, raw });
    const receipt = { message_id: messageId, accepted: result.accepted, rejected: result.rejected, response: result.response, submitted_at: new Date().toISOString() };
    // Persist SMTP success before attempting any fallible mailbox cleanup.
    await recordReceipt({ status: 'smtp_returned', smtp: receipt });
    if (result.rejected?.length || result.accepted?.length !== 1 || String(result.accepted[0]).toLowerCase() !== item.author_email.toLowerCase()) throw new Error('SMTP did not accept the sole approved recipient');
    lock = await client.getMailboxLock(sent);
    let uids = await matches();
    if (!uids.length) { await client.append(sent, raw, ['\\Seen']); uids = await matches(); }
    if (uids.length !== 1) throw new Error('Sent copy requires reconciliation');
    const m = await client.fetchOne(uids[0], { source: true }, { uid: true }), parsed = await simpleParser(m.source);
    if (parsed.subject !== action.metadata.subject || parsed.text?.replace(/\r\n/g, '\n').trim() !== action.body.replace(/\r\n/g, '\n').trim() || parsed.to?.value?.length !== 1 || parsed.to.value[0].address.toLowerCase() !== item.author_email.toLowerCase() || parsed.from?.value?.[0]?.address.toLowerCase() !== source.config.username.toLowerCase()) throw new Error('Sent copy verification failed');
    receipt.sent_mailbox = sent; receipt.sent_uid = String(uids[0]); receipt.sent_copy_verified = true;
    await recordReceipt({ status: 'sent_copy_verified', smtp: receipt });
    lock.release(); lock = null;
    if (!(await client.list()).some(f => f.path === archive)) await client.mailboxCreate(archive);
    lock = await client.getMailboxLock(drafts);
    const remaining = await matches();
    if (remaining.length !== 1 || String(remaining[0]) !== verified.uid) throw new Error('Draft cleanup requires reconciliation');
    const moved = await client.messageMove(remaining[0], archive, { uid: true });
    if (!moved || (await matches()).length) throw new Error('Draft archive requires reconciliation');
    receipt.archived_to = archive; receipt.archived_uid = String(moved.uidMap?.get(remaining[0]) || '');
    return receipt;
  } finally { transporter?.close(); lock?.release(); await client.logout().catch(() => client.close()); }
}

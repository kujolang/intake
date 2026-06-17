import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { makeLearning, makeItem, makeSource } from "./models.js";
import { classifyAndSave, proposeDraft } from "./workflow.js";
import {
  initStore,
  listActions,
  listLearnings,
  loadSources,
  saveItem,
  saveLearning,
  saveSources,
  storeRaw,
  logEvent,
  rebuildItemIndex
} from "./storage.js";
import { readJson, writeJsonAtomic } from "./util.js";

export const DEMO_SEED_ID = "demo-email-interaction-v1";
const DEMO_SOURCE_ID = "demo-email-acme-support";
const DEMO_ITEM_ID = "demo_email_acme_privateemail_setup";

export async function seedEmailDemo(root) {
  await initStore(root);
  await upsertDemoSource(root);
  const item = await upsertDemoItem(root);
  const classified = await classifyAndSave(root, item.id);
  const draft = await ensureDemoDraft(root, classified.item.id);
  const learning = await ensureDemoLearning(root, classified.item.id);
  await logEvent(root, "audit", {
    source_id: DEMO_SOURCE_ID,
    item_id: classified.item.id,
    action_id: draft.id,
    event_type: "demo_seeded",
    output_refs: [classified.item.id, draft.id, learning.id]
  });
  return {
    seed_id: DEMO_SEED_ID,
    source_id: DEMO_SOURCE_ID,
    item_id: classified.item.id,
    action_id: draft.id,
    learning_id: learning.id
  };
}

export async function clearDemo(root) {
  await initStore(root);
  const beforeSources = await loadSources(root);
  await saveSources(root, beforeSources.filter((source) => source.metadata?.demo_seed_id !== DEMO_SEED_ID && source.id !== DEMO_SOURCE_ID));
  const afterSources = await loadSources(root);
  const removed = {
    sources: beforeSources.length - afterSources.length,
    items: await removeDemoRecords(join(root, "items")),
    actions: await removeDemoRecords(join(root, "actions")),
    learnings: await removeDemoRecords(join(root, "learnings")),
    raw: await removeDemoRaw(root)
  };
  await rebuildItemIndex(root);
  await logEvent(root, "audit", {
    source_id: DEMO_SOURCE_ID,
    item_id: DEMO_ITEM_ID,
    event_type: "demo_cleared",
    policy_result: removed
  });
  return { seed_id: DEMO_SEED_ID, removed };
}

async function upsertDemoSource(root) {
  const sources = await loadSources(root);
  const source = {
    ...makeSource("email", {
      id: DEMO_SOURCE_ID,
      name: "Demo Email - Acme Support",
      enabled: false,
      config: {
        username: "support@example.test",
        from: "support@example.test",
        mailbox: "INBOX",
        imap: { host: "mail.privateemail.com", port: 993, secure: true },
        smtp: { host: "mail.privateemail.com", port: 465, secure: true }
      },
      secret_ref: "env:INTAKE_DEMO_EMAIL_PASSWORD",
      default_queue: "support",
      sync_mode: "manual",
      capabilities: ["sync_since", "send_response", "append_remote_draft", "append_remote_sent", "mark_remote_read"]
    }),
    metadata: { demo_seed_id: DEMO_SEED_ID }
  };
  await saveSources(root, [...sources.filter((candidate) => candidate.id !== DEMO_SOURCE_ID), source]);
  return source;
}

async function upsertDemoItem(root) {
  const receivedAt = "2026-06-16T13:08:00.000Z";
  const rawPath = await storeRaw(root, "email", DEMO_SOURCE_ID, DEMO_ITEM_ID, "eml", demoEmailRaw(receivedAt));
  const item = makeItem({
    id: DEMO_ITEM_ID,
    source_id: DEMO_SOURCE_ID,
    source_type: "email",
    source_native_id: "<demo-privateemail-setup-001@example.test>",
    source_thread_id: "<demo-privateemail-setup-001@example.test>",
    title: "Need help setting up PrivateEmail intake",
    body: [
      "Hi Kujo team,",
      "",
      "We want to connect three inboxes for support, billing, and sales. We use Namecheap PrivateEmail and need to understand what we should put into the dashboard.",
      "",
      "Can you confirm the IMAP/SMTP settings and whether passwords can be kept out of normal config?",
      "",
      "Thanks,",
      "Maya"
    ].join("\n"),
    author: "Maya Patel <maya@acme.example>",
    author_email: "maya@acme.example",
    participants: ["support@example.test", "ops@acme.example"],
    received_at: receivedAt,
    raw_payload_path: rawPath,
    tags: ["demo", "demo-seed"],
    queue: "support",
    attachments: [
      {
        filename: "mailbox-plan.txt",
        content_type: "text/plain",
        size: 482,
        checksum: "demo-not-a-real-attachment"
      }
    ],
    ai_summary: "Acme wants to connect support, billing, and sales PrivateEmail inboxes while keeping mailbox passwords out of config.",
    ai_confidence: 0.86,
    suggested_actions: ["draft_response", "create_learning"],
    metadata: {
      demo_seed_id: DEMO_SEED_ID,
      demo_kind: "email_interaction",
      email_headers: {
        from: "Maya Patel <maya@acme.example>",
        to: "Kujo Support <support@example.test>",
        cc: "ops@acme.example",
        subject: "Need help setting up PrivateEmail intake",
        message_id: "<demo-privateemail-setup-001@example.test>"
      }
    }
  });
  await saveItem(root, item);
  return item;
}

async function ensureDemoDraft(root, itemId) {
  const actions = await listActions(root);
  const existing = actions.find((action) => action.metadata?.demo_seed_id === DEMO_SEED_ID && action.intake_item_id === itemId);
  if (existing) return existing;
  const draft = await proposeDraft(root, itemId, {
    body: [
      "Hi Maya,",
      "",
      "Yes. For Namecheap PrivateEmail, add one email source per inbox in the Sources tab:",
      "",
      "- support-email -> support",
      "- billing-email -> billing",
      "- sales-email -> sales",
      "",
      "Use IMAP mail.privateemail.com on port 993 and SMTP mail.privateemail.com on port 465. Keep the mailbox password out of normal config by using either a .env/.intake/.env variable or macOS Keychain.",
      "",
      "After saving each source, use Test to confirm credentials and Sync to pull messages into Intake.",
      "",
      "Best,"
    ].join("\n")
  });
  const updated = {
    ...draft,
    status: "needs_review",
    proposed_by: "demo-seed",
    metadata: {
      ...draft.metadata,
      demo_seed_id: DEMO_SEED_ID,
      subject: "Re: Need help setting up PrivateEmail intake"
    }
  };
  await writeJsonAtomic(join(root, "actions", `${updated.id}.json`), updated);
  return updated;
}

async function ensureDemoLearning(root, itemId) {
  const learnings = await listLearnings(root);
  const existing = learnings.find((learning) => learning.metadata?.demo_seed_id === DEMO_SEED_ID || learning.id === "demo_learning_privateemail_setup");
  if (existing) return existing;
  const learning = {
    ...makeLearning({
      id: "demo_learning_privateemail_setup",
      source_item_ids: [itemId],
      type: "faq_candidate",
      title: "PrivateEmail intake setup needs a short FAQ",
      summary: "Prospects may need clear guidance on adding multiple PrivateEmail inboxes and storing secrets outside normal config.",
      evidence: [{ item_id: itemId, title: "Need help setting up PrivateEmail intake" }],
      proposed_update: "Add a setup FAQ covering one source per inbox, PrivateEmail IMAP/SMTP defaults, .env, and macOS Keychain.",
      confidence: 0.82
    }),
    metadata: { demo_seed_id: DEMO_SEED_ID }
  };
  await saveLearning(root, learning);
  return learning;
}

function demoEmailRaw(receivedAt) {
  return [
    "From: Maya Patel <maya@acme.example>",
    "To: Kujo Support <support@example.test>",
    "Cc: ops@acme.example",
    "Subject: Need help setting up PrivateEmail intake",
    "Message-ID: <demo-privateemail-setup-001@example.test>",
    `Date: ${new Date(receivedAt).toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Kujo team,",
    "",
    "We want to connect three inboxes for support, billing, and sales. We use Namecheap PrivateEmail and need to understand what we should put into the dashboard.",
    "",
    "Can you confirm the IMAP/SMTP settings and whether passwords can be kept out of normal config?",
    "",
    "Thanks,",
    "Maya"
  ].join("\r\n");
}

async function removeDemoRecords(dir) {
  await mkdir(dir, { recursive: true });
  let count = 0;
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const record = await readJson(path, null);
    if (isDemoRecord(record)) {
      await unlink(path);
      count += 1;
    }
  }
  return count;
}

async function removeDemoRaw(root) {
  const rawDir = join(root, "raw", "email", DEMO_SOURCE_ID);
  try {
    let count = 0;
    for (const name of await readdir(rawDir)) {
      await unlink(join(rawDir, name));
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function isDemoRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.id === DEMO_ITEM_ID || record.id === "demo_learning_privateemail_setup") return true;
  if (record.source_id === DEMO_SOURCE_ID) return true;
  if (record.metadata?.demo_seed_id === DEMO_SEED_ID) return true;
  if (record.tags?.includes("demo-seed")) return true;
  return false;
}

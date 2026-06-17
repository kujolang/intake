import { STATUS, QUEUES, RISK_LEVELS } from "./constants.js";
import { isoNow, newId, sha256, stableStringify, uniq } from "./util.js";

export function makeSource(type, options = {}) {
  const now = isoNow();
  const id = options.id || `src_${type}_${newId("", options.name || type).replace(/^_/, "")}`;
  return {
    id,
    name: options.name || type,
    type,
    adapter: options.adapter || type,
    enabled: options.enabled ?? true,
    config_ref: options.config_ref || null,
    secret_ref: options.secret_ref || null,
    config: options.config || {},
    sync_mode: options.sync_mode || "manual",
    poll_interval_minutes: Number(options.poll_interval_minutes || 15),
    default_queue: options.default_queue || "inbox",
    default_agent: options.default_agent || null,
    auto_action_policy: options.auto_action_policy || "default-safe-human-gate",
    cursor: options.cursor || null,
    capabilities: options.capabilities || [],
    created_at: options.created_at || now,
    updated_at: now
  };
}

export function makeItem(input) {
  const now = isoNow();
  const normalizedText = normalizeText([input.title, input.body, input.normalized_text].filter(Boolean).join("\n\n"));
  const contentHash = sha256(normalizedText || stableStringify(input.raw || input));
  const dedupeKey = input.dedupe_key || `${input.source_id || "unknown"}:${input.source_native_id || contentHash}`;
  return {
    id: input.id || newId("itm", dedupeKey),
    source_id: input.source_id || "manual",
    source_type: input.source_type || "manual",
    source_native_id: input.source_native_id || null,
    source_url: input.source_url || null,
    source_thread_id: input.source_thread_id || null,
    parent_id: input.parent_id || null,
    title: input.title || "(untitled)",
    body: input.body || "",
    normalized_text: normalizedText,
    author: input.author || null,
    author_id: input.author_id || null,
    author_email: input.author_email || null,
    participants: input.participants || [],
    received_at: input.received_at || now,
    updated_at: input.updated_at || now,
    raw_payload_path: input.raw_payload_path || null,
    attachments: input.attachments || [],
    content_hash: contentHash,
    dedupe_key: dedupeKey,
    status: ensureEnum(input.status || "new", STATUS, "new"),
    queue: ensureEnum(input.queue || "inbox", QUEUES, "inbox"),
    priority: input.priority || "normal",
    risk_level: ensureEnum(input.risk_level || "low", RISK_LEVELS, "low"),
    category: input.category || null,
    intent: input.intent || null,
    tags: uniq(input.tags || []),
    assigned_agent: input.assigned_agent || null,
    assigned_human: input.assigned_human || null,
    ai_summary: input.ai_summary || null,
    ai_confidence: input.ai_confidence || null,
    suggested_actions: input.suggested_actions || [],
    selected_action: input.selected_action || null,
    learning_flags: input.learning_flags || [],
    safety_flags: input.safety_flags || [],
    policy: input.policy || null,
    created_at: input.created_at || now,
    last_processed_at: input.last_processed_at || null,
    metadata: input.metadata || {}
  };
}

export function makeAction(input) {
  const now = isoNow();
  return {
    id: input.id || newId("act", `${input.intake_item_id}:${input.type}:${now}`),
    intake_item_id: input.intake_item_id,
    type: input.type,
    status: input.status || "proposed",
    proposed_by: input.proposed_by || "intake",
    approved_by: input.approved_by || null,
    source_capability_required: input.source_capability_required || null,
    body: input.body || "",
    metadata: input.metadata || {},
    risk_level: input.risk_level || "low",
    confidence: input.confidence ?? null,
    policy_result: input.policy_result || null,
    created_at: input.created_at || now,
    approved_at: input.approved_at || null,
    executed_at: input.executed_at || null,
    result: input.result || null
  };
}

export function makeLearning(input) {
  const now = isoNow();
  return {
    id: input.id || newId("lrn", `${input.type}:${input.title}:${now}`),
    source_item_ids: input.source_item_ids || [],
    type: input.type || "general",
    title: input.title || "Untitled learning",
    summary: input.summary || "",
    evidence: input.evidence || [],
    proposed_update: input.proposed_update || "",
    status: input.status || "proposed",
    confidence: input.confidence ?? 0.5,
    exported_to_strata: input.exported_to_strata || false,
    exported_to_totalrecall: input.exported_to_totalrecall || false,
    created_at: input.created_at || now,
    reviewed_at: input.reviewed_at || null
  };
}

export function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

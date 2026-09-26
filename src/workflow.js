import { withStoreLock } from "./store-lock.js";
import { withActionLock } from "./action-lock.js";
import { executeAdapterAction, syncSource } from "./adapters/index.js";
import { aiUnavailableResult, classifyWithAi, deterministicSummary, draftFallback } from "./ai.js";
import { makeAction, makeLearning } from "./models.js";
import { evaluatePolicy, nextActionCounters } from "./policy.js";
import { applyRules } from "./rules.js";
import {
  loadAction,
  loadItem,
  loadPolicies,
  loadRules,
  loadSettings,
  loadSources,
  listItemDedupeKeys,
  rebuildItemIndex,
  saveAction,
  saveItem,
  saveLearning,
  saveSettings,
  saveSources,
  logEvent
} from "./storage.js";
import { safetyCheck } from "./safety.js";
import { appendSourceSyncHistory } from "./source-history.js";
import { isoNow, uniq } from "./util.js";

export async function syncAll(root, sourceId = null) {
  return withStoreLock(root, () => syncAllLocked(root, sourceId));
}

async function syncAllLocked(root, sourceId = null) {
  const sources = await loadSources(root);
  const selected = sources.filter((source) => source.enabled && (!sourceId || source.id === sourceId));
  const out = [];
  for (const source of selected) {
    const result = await syncOne(root, source);
    out.push(result);
  }
  return out;
}

export async function syncOne(root, source) {
  return withStoreLock(root, () => syncOneLocked(root, source));
}

async function syncOneLocked(root, source) {
  const sources = await loadSources(root);
  source = sources.find((candidate) => candidate.id === source.id) || source;
  const settings = await loadSettings(root);
  const rules = await loadRules(root);
  const dedupe = new Set(await listItemDedupeKeys(root));
  const result = await syncSource(root, source);
  const saved = [];
  try {
    for (const item of result.items) {
      if (dedupe.has(item.dedupe_key)) {
        await logEvent(root, "normalize", {
          source_id: source.id,
          item_id: item.id,
          event_type: "dedupe_skip",
          status: "skipped",
          input_refs: [item.raw_payload_path]
        });
        continue;
      }
      dedupe.add(item.dedupe_key);
      await logEvent(root, "normalize", {
        source_id: source.id,
        item_id: item.id,
        event_type: "item_normalized",
        output_refs: [item.raw_payload_path],
        status: "ok"
      });
      await classifyItemAndSave(root, item, {
        rebuildIndex: false,
        ai: settings.ai_enabled === true
      }, rules, settings);
      saved.push(item.id);
    }
  } finally {
    if (result.items.length > 0) await rebuildItemIndex(root);
  }
  const syncedAt = isoNow();
  const syncResult = { ok: true, saved_count: saved.length, cursor: result.cursor };
  const nextSources = sources.map((candidate) =>
    candidate.id === source.id ? appendSourceSyncHistory({
      ...candidate,
      cursor: result.cursor,
      last_synced_at: syncedAt,
      last_sync_result: syncResult,
      updated_at: syncedAt
    }, syncResult, syncedAt) : candidate
  );
  await saveSources(root, nextSources);
  await logEvent(root, "sync", {
    source_id: source.id,
    event_type: "source_sync",
    status: "ok",
    output_refs: saved
  });
  return { source_id: source.id, saved };
}

export async function classifyAndSave(root, itemId, options = {}) {
  return withStoreLock(root, () => classifyAndSaveLocked(root, itemId, options));
}

async function classifyAndSaveLocked(root, itemId, options = {}) {
  const item = await requireItem(root, itemId);
  const rules = await loadRules(root);
  const settings = await loadSettings(root);
  return classifyItemAndSave(root, item, options, rules, settings);
}

async function classifyItemAndSave(root, item, options, rules, settings) {
  const { item: ruled, matches } = applyRules(item, rules);
  const safety = safetyCheck(ruled);
  let next = {
    ...ruled,
    safety_flags: uniq([...(ruled.safety_flags || []), ...safety.flags]),
    risk_level: safety.risk_level,
    policy: { ...ruled.policy, requires_human_review: safety.requires_human_review },
    status: safety.requires_human_review ? "needs_review" : ruled.status
  };

  let ai = null;
  if (options.ai || options.useAi) {
    ai = await classifyWithAi(next, settings);
    next = mergeAiResult(next, ai);
  } else {
    ai = aiUnavailableResult(next);
  }

  await saveItem(root, next, { rebuildIndex: options.rebuildIndex !== false });
  await logEvent(root, "classify", {
    source_id: next.source_id,
    item_id: next.id,
    event_type: "item_classified",
    risk_level: next.risk_level,
    policy_result: { rule_matches: matches.map((match) => match.id), safety_flags: safety.flags, ai_used: Boolean(options.ai || options.useAi) }
  });
  return { item: next, matches, safety, ai };
}

function mergeAiResult(item, ai) {
  const next = { ...item };
  if (ai.summary) next.ai_summary = ai.summary;
  if (Array.isArray(ai.suggested_tags)) next.tags = uniq([...(next.tags || []), ...ai.suggested_tags]);
  if (ai.suggested_category && !next.category) next.category = ai.suggested_category;
  if (ai.suggested_queue && next.queue === "inbox") next.queue = ai.suggested_queue;
  if (ai.risk_level && ["low", "medium", "high", "critical"].includes(ai.risk_level)) {
    next.risk_level = highestRisk(next.risk_level, ai.risk_level);
  }
  if (typeof ai.confidence === "number") next.ai_confidence = ai.confidence;
  if (ai.suggested_action) next.suggested_actions = uniq([...(next.suggested_actions || []), ai.suggested_action]);
  if (ai.human_review_required) {
    next.policy = { ...next.policy, requires_human_review: true };
    if (next.status !== "resolved") next.status = "needs_review";
  }
  return next;
}

function highestRisk(current, candidate) {
  const order = { low: 0, medium: 1, high: 2, critical: 3 };
  const currentRisk = order[current] === undefined ? "low" : current;
  const candidateRisk = order[candidate] === undefined ? "low" : candidate;
  return order[candidateRisk] > order[currentRisk] ? candidateRisk : currentRisk;
}

export async function proposeDraft(root, itemId, options = {}) {
  return withStoreLock(root, () => proposeDraftLocked(root, itemId, options));
}

async function proposeDraftLocked(root, itemId, options = {}) {
  const item = await requireItem(root, itemId);
  const source = await sourceFor(root, item.source_id);
  const settings = await loadSettings(root);
  const policies = await loadPolicies(root);
  const body = options.body || draftFallback(item);
  const policyResult = evaluatePolicy({ item, actionType: "draft_response", policies, settings, source });
  const action = makeAction({
    intake_item_id: item.id,
    source_id: item.source_id,
    type: "draft_response",
    status: policyResult.requires_human_review ? "needs_review" : "proposed",
    body,
    risk_level: item.risk_level,
    confidence: item.ai_confidence,
    policy_result: policyResult,
    metadata: {
      subject: `Re: ${item.title}`,
      summary: item.ai_summary || deterministicSummary(item)
    }
  });
  await saveAction(root, action);
  await saveItem(root, { ...item, status: "draft_ready", selected_action: action.id, suggested_actions: uniq([...(item.suggested_actions || []), "draft_response"]) });
  await logEvent(root, "actions", {
    source_id: item.source_id,
    item_id: item.id,
    action_id: action.id,
    event_type: "draft_created",
    risk_level: item.risk_level,
    policy_result: policyResult
  });
  return action;
}

export async function approveAction(root, actionId, approvedBy = "local-operator") {
  return withStoreLock(root, () => approveActionStoreLocked(root, actionId, approvedBy));
}

async function approveActionStoreLocked(root, actionId, approvedBy = "local-operator") {
  return withActionLock(root, () => approveActionLocked(root, actionId, approvedBy));
}

async function approveActionLocked(root, actionId, approvedBy = "local-operator") {
  const action = await requireAction(root, actionId);
  if (["executed", "rejected"].includes(action.status)) {
    return action;
  }
  const next = { ...action, status: "approved", approved_by: approvedBy, approved_at: isoNow() };
  await saveAction(root, next);
  await logEvent(root, "actions", { item_id: next.intake_item_id, action_id: next.id, event_type: "action_approved" });
  return next;
}

export async function rejectAction(root, actionId, approvedBy = "local-operator") {
  return withStoreLock(root, () => rejectActionStoreLocked(root, actionId, approvedBy));
}

async function rejectActionStoreLocked(root, actionId, approvedBy = "local-operator") {
  return withActionLock(root, () => rejectActionLocked(root, actionId, approvedBy));
}

async function rejectActionLocked(root, actionId, approvedBy = "local-operator") {
  const action = await requireAction(root, actionId);
  if (action.status === "executed") {
    return action;
  }
  const next = { ...action, status: "rejected", approved_by: approvedBy, approved_at: isoNow() };
  await saveAction(root, next);
  await logEvent(root, "actions", { item_id: next.intake_item_id, action_id: next.id, event_type: "action_rejected", status: "rejected" });
  return next;
}

export async function runAction(root, actionId) {
  return withStoreLock(root, () => runActionStoreLocked(root, actionId));
}

async function runActionStoreLocked(root, actionId) {
  return withActionLock(root, () => runActionLocked(root, actionId));
}

async function runActionLocked(root, actionId) {
  const action = await requireAction(root, actionId);
  if (["executed", "rejected"].includes(action.status)) {
    return action;
  }
  if (["executing", "execution_uncertain"].includes(action.status)) {
    throw new Error("action outcome is uncertain; reconcile the external effect and explicitly approve before retrying");
  }
  const item = await requireItem(root, action.intake_item_id);
  const source = await sourceFor(root, item.source_id);
  const settings = await loadSettings(root);
  const policies = await loadPolicies(root);
  const actionType = action.type === "draft_response" && source?.type === "email" ? "append_remote_draft" : action.type;
  const policyResult = evaluatePolicy({ item, actionType, policies, settings, source });
  if (policyResult.blocked || !policyResult.allowed) {
    const blocked = {
      ...action,
      status: "blocked",
      result: {
        error: "action is blocked by policy",
        policy_result: policyResult
      }
    };
    await saveAction(root, blocked);
    await logEvent(root, "actions", {
      source_id: item.source_id,
      item_id: item.id,
      action_id: action.id,
      event_type: "action_policy_blocked",
      status: "blocked",
      risk_level: item.risk_level,
      policy_result: policyResult
    });
    return blocked;
  }
  if (action.status !== "approved" && !policyResult.auto_execute_allowed) {
    const blocked = { ...action, status: "blocked", result: { error: "action requires approval before execution", policy_result: policyResult } };
    await saveAction(root, blocked);
    await logEvent(root, "actions", {
      source_id: item.source_id,
      item_id: item.id,
      action_id: action.id,
      event_type: "action_blocked",
      status: "blocked",
      risk_level: item.risk_level,
      policy_result: policyResult
    });
    return blocked;
  }
  const autoExecuted = action.status !== "approved" && policyResult.auto_execute_allowed;

  await saveAction(root, { ...action, status: "executing" });
  if (autoExecuted) {
    await saveSettings(root, { ...settings, action_counters: nextActionCounters(settings, actionType), updated_at: isoNow() });
  }
  let result;
  try {
    if (action.metadata?.demo_seed_id) {
      result = { demo: true, dry_run: true, note: "Demo action executed locally; no outbound email was sent or appended." };
    } else if (action.type === "draft_response" && source?.type === "email") {
      result = await executeAdapterAction(source, { ...action, type: "append_remote_draft" }, item);
    } else if (action.type === "send_response") {
      result = await executeAdapterAction(source, action, item);
    } else if (action.type === "comment_issue") {
      result = await executeAdapterAction(source, action, item);
    } else if (action.type === "mark_resolved") {
      await saveItem(root, { ...item, status: "resolved", queue: "resolved", updated_at: isoNow() });
      result = { resolved: true };
    } else if (action.type === "create_learning") {
      const learning = await createLearning(root, item.id);
      result = { learning_id: learning.id };
    } else {
      result = { dry_run: true, note: `No adapter executor for ${action.type}; recorded as executed local action.` };
    }
  } catch (error) {
    await saveAction(root, { ...action, status: "execution_uncertain", result: { error: "execution failed; reconcile before retrying" } });
    throw error;
  }
  const next = { ...action, status: "executed", executed_at: isoNow(), result };
  await saveAction(root, next);
  await logEvent(root, "actions", {
    source_id: item.source_id,
    item_id: item.id,
    action_id: action.id,
    event_type: "action_executed",
    risk_level: item.risk_level,
    policy_result: policyResult
  });
  return next;
}

export async function createLearning(root, itemId, input = {}) {
  return withStoreLock(root, () => createLearningLocked(root, itemId, input));
}

async function createLearningLocked(root, itemId, input = {}) {
  const item = await requireItem(root, itemId);
  const learning = makeLearning({
    source_item_ids: [item.id],
    source_id: item.source_id,
    type: input.type || (item.tags?.includes("faq-candidate") ? "faq_candidate" : "item_learning"),
    title: input.title || `Learning from ${item.title}`,
    summary: input.summary || item.ai_summary || deterministicSummary(item),
    evidence: [{ item_id: item.id, title: item.title, risk_level: item.risk_level, queue: item.queue }],
    proposed_update: input.proposed_update || `Review this ${item.category || "intake"} pattern for Strata/TotalRecall.`,
    confidence: input.confidence ?? item.ai_confidence ?? 0.6
  });
  await saveLearning(root, learning);
  await saveItem(root, { ...item, learning_flags: uniq([...(item.learning_flags || []), learning.type]), updated_at: isoNow() });
  await logEvent(root, "audit", { source_id: item.source_id, item_id: item.id, event_type: "learning_created", output_refs: [learning.id] });
  return learning;
}

export async function setAutoActions(root, enabled) {
  return withStoreLock(root, () => setAutoActionsLocked(root, enabled));
}

async function setAutoActionsLocked(root, enabled) {
  const settings = await loadSettings(root);
  const next = { ...settings, auto_actions_enabled: Boolean(enabled), updated_at: isoNow() };
  await saveSettings(root, next);
  await logEvent(root, "policy", { event_type: enabled ? "auto_actions_enabled" : "auto_actions_disabled", status: "ok" });
  return next;
}

export async function requireItem(root, itemId) {
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  return item;
}

async function requireAction(root, actionId) {
  const action = await loadAction(root, actionId);
  if (!action) throw new Error(`no such action: ${actionId}`);
  return action;
}

async function sourceFor(root, sourceId) {
  const sources = await loadSources(root);
  return sources.find((source) => source.id === sourceId) || null;
}

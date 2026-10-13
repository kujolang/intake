import { riskAtMost } from "./rules.js";

export function evaluatePolicy({ item, actionType, policies, settings, source, now = new Date() }) {
  const applicable = policies.find((policy) => policyApplies(policy, item)) || { id: null, allowed_actions: [], blocked_actions: ["*"], requires_human_review: true };
  const policyAllowed = applicable.allowed_actions.includes(actionType) || applicable.allowed_actions.includes("*");
  const sourceAllowed = !Array.isArray(source?.config?.allowed_actions) || source.config.allowed_actions.includes(actionType) || source.config.allowed_actions.includes("*");
  const allowed = policyAllowed && sourceAllowed;
  const ruleBlocks = item.policy?.blocked_actions || [];
  const blocked = applicable.blocked_actions.includes(actionType) || applicable.blocked_actions.includes("*") || ruleBlocks.includes(actionType) || ruleBlocks.includes("*");
  const confidenceThreshold = Number(applicable.confidence_threshold || 0);
  const confidence = Number(item.ai_confidence);
  const confidenceMet = confidenceThreshold === 0 || (item.ai_confidence != null && Number.isFinite(confidence) && confidence >= confidenceThreshold);
  const underRisk = riskAtMost(item.risk_level || "low", applicable.risk_ceiling || "low");
  const globalAutoEnabled = settings.auto_actions_enabled === true;
  const sourceAutoEnabled = source ? source.auto_action_policy !== "disabled" : true;
  const rateBudget = autoActionBudget(settings, applicable, now);
  const requiresHumanReview =
    applicable.requires_human_review ||
    item.status === "needs_review" ||
    item.policy?.requires_human_review === true ||
    ruleBlocks.includes("auto_execute") ||
    !confidenceMet ||
    item.risk_level === "high" ||
    item.risk_level === "critical" ||
    blocked ||
    !underRisk;

  return {
    policy_id: applicable.id,
    allowed: allowed && !blocked,
    blocked,
    risk_within_ceiling: underRisk,
    requires_human_review: requiresHumanReview,
    auto_execute_allowed:
      allowed &&
      !blocked &&
      !requiresHumanReview &&
      underRisk &&
      globalAutoEnabled &&
      sourceAutoEnabled &&
      applicable.auto_execute_allowed === true &&
      rateBudget.allowed,
    reasons: [
      !policyAllowed ? "action is not in policy allowed_actions" : null,
      !sourceAllowed ? "action is not in source allowed_actions" : null,
      blocked ? "action is in blocked_actions" : null,
      !confidenceMet ? "item confidence is below policy threshold" : null,
      !underRisk ? `item risk ${item.risk_level} exceeds policy ceiling ${applicable.risk_ceiling}` : null,
      !globalAutoEnabled ? "global auto-action kill switch is off" : null,
      !sourceAutoEnabled ? "source auto-actions are disabled" : null,
      !rateBudget.allowed ? rateBudget.reason : null,
      requiresHumanReview ? "human review required before execution" : null
    ].filter(Boolean),
    rate_budget: rateBudget
  };
}

export function nextActionCounters(settings, actionType, now = new Date()) {
  const counters = settings.action_counters ?? {};
  const hourKey = now.toISOString().slice(0, 13);
  const dayKey = now.toISOString().slice(0, 10);
  const current = counters[actionType] || {};
  return {
    ...counters,
    [actionType]: {
      hour_key: hourKey,
      hour_count: current.hour_key === hourKey ? Number(current.hour_count || 0) + 1 : 1,
      day_key: dayKey,
      day_count: current.day_key === dayKey ? Number(current.day_count || 0) + 1 : 1
    }
  };
}

function autoActionBudget(settings, policy, now) {
  const counters = settings.action_counters ?? {};
  const hourKey = now.toISOString().slice(0, 13);
  const dayKey = now.toISOString().slice(0, 10);
  const maxHour = budgetNumber(policy.max_auto_actions_per_hour ?? 0);
  const maxDay = budgetNumber(policy.max_auto_actions_per_day ?? 0);
  const invalid = { allowed: false, reason: "invalid auto-action budget configuration or counters", hour_remaining: 0, day_remaining: 0 };
  if (!Number.isFinite(maxHour) || !Number.isFinite(maxDay)) return invalid;
  if (maxHour <= 0 && maxDay <= 0) return { allowed: true, hour_remaining: null, day_remaining: null };
  if (!counters || typeof counters !== "object" || Array.isArray(counters)) return invalid;
  let hourUsed = 0;
  let dayUsed = 0;
  for (const counter of Object.values(counters)) {
    if (!counter || typeof counter !== "object" || Array.isArray(counter)) return invalid;
    if (counter.hour_key === hourKey) {
      const count = budgetNumber(counter.hour_count);
      if (!Number.isFinite(count)) return invalid;
      hourUsed += count;
    }
    if (counter.day_key === dayKey) {
      const count = budgetNumber(counter.day_count);
      if (!Number.isFinite(count)) return invalid;
      dayUsed += count;
    }
  }
  if (maxHour > 0 && hourUsed >= maxHour) return { allowed: false, reason: "hourly auto-action budget exhausted", hour_remaining: 0, day_remaining: maxDay > 0 ? Math.max(0, maxDay - dayUsed) : null };
  if (maxDay > 0 && dayUsed >= maxDay) return { allowed: false, reason: "daily auto-action budget exhausted", hour_remaining: maxHour > 0 ? Math.max(0, maxHour - hourUsed) : null, day_remaining: 0 };
  return {
    allowed: true,
    hour_remaining: maxHour > 0 ? Math.max(0, maxHour - hourUsed) : null,
    day_remaining: maxDay > 0 ? Math.max(0, maxDay - dayUsed) : null
  };
}

function budgetNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
}

function policyApplies(policy, item) {
  const sources = policy.applies_to_sources || ["*"];
  const categories = policy.applies_to_categories || ["*"];
  return (
    (sources.includes("*") || sources.includes(item.source_id) || sources.includes(item.source_type)) &&
    (categories.includes("*") || categories.includes(item.category))
  );
}

import { riskAtMost } from "./rules.js";

export function evaluatePolicy({ item, actionType, policies, settings, source }) {
  const applicable = policies.find((policy) => policyApplies(policy, item)) || policies[0];
  const policyAllowed = applicable.allowed_actions.includes(actionType) || applicable.allowed_actions.includes("*");
  const sourceAllowed = !Array.isArray(source?.config?.allowed_actions) || source.config.allowed_actions.includes(actionType) || source.config.allowed_actions.includes("*");
  const allowed = policyAllowed && sourceAllowed;
  const blocked = applicable.blocked_actions.includes(actionType) || applicable.blocked_actions.includes("*");
  const underRisk = riskAtMost(item.risk_level || "low", applicable.risk_ceiling || "low");
  const globalAutoEnabled = Boolean(settings.auto_actions_enabled);
  const sourceAutoEnabled = source ? source.auto_action_policy !== "disabled" : true;
  const rateBudget = autoActionBudget(settings, applicable);
  const requiresHumanReview =
    applicable.requires_human_review ||
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
      underRisk &&
      globalAutoEnabled &&
      sourceAutoEnabled &&
      applicable.auto_execute_allowed === true &&
      rateBudget.allowed,
    reasons: [
      !policyAllowed ? "action is not in policy allowed_actions" : null,
      !sourceAllowed ? "action is not in source allowed_actions" : null,
      blocked ? "action is in blocked_actions" : null,
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
  const counters = settings.action_counters || {};
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

function autoActionBudget(settings, policy) {
  const counters = settings.action_counters || {};
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13);
  const dayKey = now.toISOString().slice(0, 10);
  const maxHour = Number(policy.max_auto_actions_per_hour || 0);
  const maxDay = Number(policy.max_auto_actions_per_day || 0);
  if (maxHour <= 0 && maxDay <= 0) return { allowed: true, hour_remaining: null, day_remaining: null };
  let hourUsed = 0;
  let dayUsed = 0;
  for (const counter of Object.values(counters)) {
    if (counter.hour_key === hourKey) hourUsed += Number(counter.hour_count || 0);
    if (counter.day_key === dayKey) dayUsed += Number(counter.day_count || 0);
  }
  if (maxHour > 0 && hourUsed >= maxHour) return { allowed: false, reason: "hourly auto-action budget exhausted", hour_remaining: 0, day_remaining: maxDay > 0 ? Math.max(0, maxDay - dayUsed) : null };
  if (maxDay > 0 && dayUsed >= maxDay) return { allowed: false, reason: "daily auto-action budget exhausted", hour_remaining: maxHour > 0 ? Math.max(0, maxHour - hourUsed) : null, day_remaining: 0 };
  return {
    allowed: true,
    hour_remaining: maxHour > 0 ? Math.max(0, maxHour - hourUsed) : null,
    day_remaining: maxDay > 0 ? Math.max(0, maxDay - dayUsed) : null
  };
}

function policyApplies(policy, item) {
  const sources = policy.applies_to_sources || ["*"];
  const categories = policy.applies_to_categories || ["*"];
  return (
    (sources.includes("*") || sources.includes(item.source_id) || sources.includes(item.source_type)) &&
    (categories.includes("*") || categories.includes(item.category))
  );
}

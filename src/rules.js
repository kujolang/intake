import { RISK_LEVELS } from "./constants.js";
import { includesAny, isoNow, uniq } from "./util.js";

const RISK_RANK = new Map(RISK_LEVELS.map((risk, index) => [risk, index]));

export function applyRules(item, rules) {
  const text = `${item.title || ""}\n${item.body || ""}\n${item.normalized_text || ""}`.toLowerCase();
  const matched = [];
  let next = { ...item, tags: [...(item.tags || [])], suggested_actions: [...(item.suggested_actions || [])] };

  const blockedActions = [];
  for (const rule of rules) {
    if (rule.status && rule.status !== "approved") continue;
    const terms = rule.match_any || [];
    if (!terms.length || !includesAny(text, terms)) continue;
    matched.push({
      id: rule.id,
      version: rule.version || 1,
      description: rule.description,
      matched_terms: terms.filter((term) => text.includes(String(term).toLowerCase()))
    });
    blockedActions.push(...(rule.blocked_actions || []));
    next.tags = uniq([...(next.tags || []), ...(rule.tags || [])]);
    next.suggested_actions = uniq([...(next.suggested_actions || []), ...(rule.suggested_actions || [])]);
    if (rule.category) next.category = rule.category;
    if (rule.intent) next.intent = rule.intent;
    if (rule.queue) next.queue = rule.queue;
    if (riskGreater(rule.risk_level, next.risk_level)) next.risk_level = rule.risk_level;
    if (rule.risk_level === "high" || rule.risk_level === "critical") {
      next.status = "needs_review";
    } else if (next.status === "new") {
      next.status = "triaged";
    }
  }

  next.last_processed_at = isoNow();
  next.policy = {
    ...(next.policy || {}),
    rule_matches: matched,
    blocked_actions: uniq(blockedActions)
  };
  return { item: next, matches: matched };
}

export function explainRules(item, rules) {
  const result = applyRules(item, rules);
  if (!result.matches.length) {
    return [`No deterministic rules matched ${item.id}. Default queue remains ${item.queue}.`];
  }
  return result.matches.map((match) => {
    const terms = match.matched_terms.length ? match.matched_terms.join(", ") : "configured terms";
    return `${match.id} v${match.version}: ${match.description} (matched: ${terms})`;
  });
}

export function proposeRuleFromItem(item) {
  const words = item.normalized_text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 8);
  return {
    id: `proposed-${item.id}`,
    version: 1,
    description: `Proposed rule from ${item.id}`,
    match_any: uniq(words),
    tags: item.tags || [],
    category: item.category || "support",
    intent: item.intent || "needs_triage",
    queue: item.queue || "needs-review",
    risk_level: item.risk_level || "medium",
    status: "proposed",
    source_item_id: item.id,
    created_at: isoNow(),
    updated_at: isoNow()
  };
}

export function riskGreater(a, b) {
  return (RISK_RANK.get(a) ?? 0) > (RISK_RANK.get(b) ?? 0);
}

export function riskAtMost(a, ceiling) {
  return (RISK_RANK.get(a) ?? 0) <= (RISK_RANK.get(ceiling) ?? 0);
}

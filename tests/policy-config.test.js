import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../src/policy.js";
const base = { id: "auto", allowed_actions: ["*"], blocked_actions: [], risk_ceiling: "low", requires_human_review: false, auto_execute_allowed: true };
function evaluate(policy = {}, settings = {}) {
  return evaluatePolicy({ item: { risk_level: "low" }, actionType: "mark_resolved", policies: [{ ...base, ...policy }], settings: { auto_actions_enabled: true, ...settings }, now: new Date("2026-01-01T12:00:00Z") });
}
test("automatic execution requires a boolean kill-switch opt-in", () => {
  assert.equal(evaluate().auto_execute_allowed, true);
  for (const value of ["false", "true", 1, {}, []]) assert.equal(evaluate({}, { auto_actions_enabled: value }).auto_execute_allowed, false);
});
test("invalid auto-action limits and active counters fail closed", () => {
  for (const value of ["invalid", -1, 1.5, Infinity, true, [], {}]) {
    const result = evaluate({ max_auto_actions_per_hour: value });
    assert.equal(result.auto_execute_allowed, false);
    assert.equal(result.rate_budget.allowed, false);
  }
  const now = new Date("2026-01-01T12:00:00Z");
  for (const count of ["invalid", -1, 1.5, Infinity]) {
    const result = evaluate({ max_auto_actions_per_hour: 2 }, { action_counters: { mark_resolved: { hour_key: now.toISOString().slice(0, 13), hour_count: count } } });
    assert.equal(result.auto_execute_allowed, false);
  }
  assert.equal(evaluate({ max_auto_actions_per_hour: "2" }).auto_execute_allowed, true);
  assert.equal(evaluate({ max_auto_actions_per_hour: 0 }).auto_execute_allowed, true);
});

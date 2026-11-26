# Policy Engine

Policies are deterministic JSON records. They define allowed actions, blocked actions, risk ceilings, confidence thresholds, review requirements, auto-execute permissions, and rate caps.

The default policy permits safe local drafting/export actions and blocks direct sending. High and critical risk items require human review.

## Preview

Use policy preview before approving or enabling automation:

```sh
intake policy preview ITEM_ID draft_response
```

The result reports:

- matching policy id
- allowed/blocked status
- risk ceiling status
- human review requirement
- auto-execute eligibility
- rate budget state
- explanatory reasons

## Source Allowlists

A source can define `config.allowed_actions` to narrow what the source may execute even when the global policy allows more. This is useful for high-risk sources or new integrations.

## Auto-Action Counters

When an action executes through auto-action allowance, Intake records hourly and daily action counters in settings. These counters are evaluated against policy rate caps before future auto-actions can execute.


Automatic execution honors `requires_human_review`, persistent item review requirements, rule `blocked_actions` (including `auto_execute`), confidence thresholds and risk ceilings. Empty or nonmatching policies deny actions instead of falling back to an unrelated policy. Explicit approval may satisfy a review requirement but cannot override an action veto. Proposed/rejected rules are inactive; legacy rules without a status remain active.

Source synchronization snapshots rules/settings once per batch, applying a consistent policy configuration and avoiding repeated reads for every item. Manual classification reads the current configuration.

Reclassification preserves an item's existing review requirement. An AI result that requests human review or explicitly disallows automation also requires human review. Explicit operator approval applies to an individual action.

Action attempts reserve automatic budgets before invoking adapters. Uncertain attempts retain their reservation and refuse rejection while the outcome is recorded as uncertain. To retry, reconcile the external effect and explicitly approve the action again. Editing the body, type, or risk of an action clears approval and requires review. Failed run attempts preserve that review requirement even when automatic execution is enabled. Older records marked approved without an approver and valid timestamp require explicit approval again.

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

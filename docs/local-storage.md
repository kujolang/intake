# Local Storage

State lives in `.intake/` by default:

- `config/*.json` for sources, rules, policies, agents, settings.
- `raw/` for original source payloads.
- `items/`, `actions/`, and `learnings/` for atomic JSON records.
- `logs/*.jsonl` for audit and operational logs.
- `strata/daily/` and `totalrecall/exports/` for integration artifacts.

Secrets are referenced, not stored.

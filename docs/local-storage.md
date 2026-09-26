# Local Storage

State lives in `.intake/` by default:

- `config/*.json` for sources, rules, policies, agents, settings.
- `raw/` for original source payloads.
- `items/`, `actions/`, and `learnings/` for atomic JSON records.
- `logs/*.jsonl` for audit and operational logs.
- `strata/daily/` and `totalrecall/exports/` for integration artifacts.

Prefer environment or Keychain secret references. Legacy inline source credentials are supported, masked in source exports, and omitted from default backups.

Use one writer process per store. Record/index updates are serialized within one process; full multi-process transactions and concurrent retention/backup snapshots are not provided. Stop writers for maintenance. Action execution has a separate cross-process `.action-lock` and explicit uncertain-outcome recovery; see the README hardening notes.

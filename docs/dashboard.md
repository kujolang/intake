# Dashboard

Start:

```sh
intake dashboard --port 8787
```

The dashboard is local-only by default:

- Binds to `127.0.0.1`.
- Requires a local auth token for every API request.
- Emits no telemetry.
- Uses the same `.intake/` files and workflow functions as the CLI.

Views:

- Sources: guided first-source setup, add/edit email, file, webhook, Slack, GitHub, Jira, Linear, ClickUp, and manual sources; test sources; sync sources; enable or disable sources.
- Items: queue filters, risk/status filters, item detail, normalized text, raw payload, AI summary, tags, queue changes, classify/draft/learn/resolve/block controls.
- Actions: approve, reject, and run actions.
- Learnings: review generated learning records.
- Rules: inspect deterministic rules.
- Audit: inspect JSONL operational logs.
- Work surface: draft body, queue/tag controls, raw payload inspection.

Auto-actions remain off by default. The dashboard exposes the same global kill switch as `intake auto-actions`.

## Email Setup

Open `Sources`, choose the `PrivateEmail` setup profile, and fill:

- `ID`
- `Name`
- `Username`
- `Password env`
- `Default queue`
- IMAP/SMTP fields

For Namecheap PrivateEmail, the default host and port values are already set. `Password env` should be an environment variable name, not the mailbox password itself.

Secrets can come from:

- `.env` or `.intake/.env` with `Secret storage: env`
- macOS Keychain with `Secret storage: keychain`

Add a macOS Keychain secret:

```sh
security add-generic-password -s kujo-intake -a support@example.com -w "mailbox-password" -U
```

Then use:

- `Keychain service`: `kujo-intake`
- `Keychain account`: `support@example.com`

## Multiple Sources

Add one source per inbox or external feed:

- `support-email` -> queue `support`
- `sales-email` -> queue `sales`
- `billing-email` -> queue `billing`
- `slack-support-webhook` -> queue `support`
- `github-issues-webhook` -> queue `engineering`

Use the native source type when Intake has one:

- `slack` for signed Slack Events API messages.
- `github` for signed issue webhooks and approved issue comments.
- `jira`, `linear`, and `clickup` for provider-aware issue intake.

Use `webhook` only for custom systems that do not have a native source type yet.

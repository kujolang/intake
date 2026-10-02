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

Non-local binding is intentionally stricter:

- Requires `--allow-non-local`.
- Requires `--tls-cert` and `--tls-key`.
- Requires `--token` or `INTAKE_DASHBOARD_TOKEN`.
- Requires the explicit token to be at least 20 characters.

The Settings view includes a security posture panel showing whether the active runtime is local-only, HTTPS-backed, and token-hardened.

Views:

- Sources: guided first-source setup, add/edit email, file, webhook, Slack, GitHub, Jira, Linear, ClickUp, and manual sources; test sources; sync sources; enable or disable sources.
- Inbox: familiar Inbox, Later, Mine, Unassigned, and Done views; queue filters; item detail; assignment; snooze; classify, draft, learn, resolve, and block controls.
- Approvals: approve, reject, and run actions; filter approval audit rows by operator, source, action type, status, and date; export approval audit CSV.
- Learnings: review generated learning records.
- Rules: inspect deterministic rules.
- Audit: inspect JSONL operational logs.
- Reply & actions: draft body, assignment, snooze, queue/tag controls, and raw payload inspection.

Keyboard shortcuts:

- `Command/Ctrl+K` or `?`: open Quick commands.
- `/`: focus inbox search.
- `j` / `k`: move to the next or previous loaded item.
- `e`: mark the selected item Done.
- `s`: snooze the selected item until tomorrow morning.
- `g i`, `g l`, `g a`: go to Inbox, Later, or Approvals.

On a narrow screen, use **Inbox views** to open the filters and saved views. Security posture, dashboard-token rotation, and policy controls live under **Settings → Advanced settings** so the everyday operator path stays focused.

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

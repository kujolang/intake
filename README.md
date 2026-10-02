# Kujo Intake

[![Version](https://img.shields.io/badge/version-1.0.0-black)](https://github.com/kujolang/intake)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![built with Kujo](https://img.shields.io/badge/built%20with-Kujo-white.svg)](https://github.com/kujolang/kujo)

Kujo Intake turns inbound business noise into agent-readable work.

It is a local-first intake layer for email, webhooks, local file drops, and manual operator input. Intake normalizes every source into a durable `IntakeItem`, applies deterministic rules and safety checks, proposes actions, requires approval where policy says it must, and exports reviewed learnings to Strata and TotalRecall-compatible files.

Intake is designed as a showcase-quality reference app for the Kujo ecosystem: practical enough to run locally, small enough to understand, and structured enough to extend into new source adapters and agent workflows.

## What It Does

```text
Source -> Adapter -> Raw payload -> IntakeItem -> Rules/Safety -> Queue -> Draft/Action -> Approval -> Audit log -> Learning export
```

- Normalizes inbound work from `manual`, `file`, `webhook`, `slack`, `github`, `jira`, `linear`, `clickup`, and `email` sources.
- Routes work through deterministic rules for support, billing, legal, security, bugs, docs, and FAQ patterns.
- Blocks unsafe auto-send behavior by default.
- Treats prompt injection and credential-seeking inbound text as hostile data.
- Creates human-reviewed draft actions before touching remote mailboxes.
- Stores raw payloads, normalized records, actions, learnings, indexes, and logs under `.intake/`.
- Runs with or without AI; AI hooks must pass through the same policy and audit path as deterministic actions.

Intake is not an email client, not TotalRecall, and not BZBY. Email is one adapter. TotalRecall remembers what happened. BZBY can later operate across queues. Intake owns the active question: what just came in, and what should happen next?

## Current Readiness

This project is ready for local-first live mailbox smoke testing and source-adapter development. It is not yet a fully packaged enterprise deployment.

Production-oriented safeguards already in place:

- Local-only dashboard binding by default.
- Token-authenticated dashboard API.
- Secret references instead of stored mailbox passwords.
- `.env`, `.intake/.env`, and macOS Keychain secret support.
- IMAP and SMTP readiness checks for email sources.
- Secure IMAP/SMTP defaults for PrivateEmail.
- Atomic JSON writes for local state.
- Storage schema metadata and doctor validation.
- Portable backup, verify, restore, and rotation commands.
- Retention and safe purge controls.
- Native signed Slack Events API receiver.
- Provider-aware GitHub, Jira, Linear, and ClickUp issue webhook receivers.
- Approved GitHub issue comments behind policy and human approval gates.
- Source templates for common systems.
- Deterministic audit/error/action/sync logs with redaction.
- Bounded dashboard and webhook request bodies.
- Dashboard launch tokens are removed from the browser URL after capture.
- Constant-time webhook token checks.
- Safe record ID and raw-payload path handling.
- Optional HTTPS for explicitly non-local dashboard deployments.
- Explicit stable dashboard token required for non-local dashboard deployments.
- Compact item index dedupe path for fast repeated no-op syncs.
- Compact sorted indexes for warm dashboard item, action, and learning reads.
- Default policy blocks direct `send_response`.

Before calling it enterprise-ready for a team or customer deployment, validate the remaining work in the [next production-readiness sweep](docs/next-production-readiness-sweep.md).

## Install

```sh
npm install
npm link
intake init
```

Requires Node.js 20.19.0 or newer (matching the locked email parser dependencies).

Without `npm link`, run commands through Node:

```sh
node bin/intake.js init
```

New developers should start with [docs/developer-onboarding-howto.md](docs/developer-onboarding-howto.md) for local setup, architecture, source adapters, dashboard workflow, testing gates, and PR expectations.

## Common Commands

```sh
intake source add manual --id manual --name Manual
intake item create --title "Client asked about pricing" --body "Follow up with details" --queue sales
intake items
intake show ITEM_ID
intake classify ITEM_ID
intake draft ITEM_ID
intake approve ACTION_ID
intake run ACTION_ID
intake policy preview ITEM_ID draft_response
intake learn ITEM_ID
intake strata daily
intake totalrecall export
intake backup create --keep 7
intake backup verify BACKUP_PATH
intake backup restore BACKUP_PATH --target RESTORE_DIR
intake retention apply --raw-days 90 --logs-days 180 --dry-run
intake purge items --status resolved --before 2026-01-01 --dry-run
intake templates list
intake onboarding privateemail
intake source clone support-email support-email-copy
intake config export --output intake-config.json
intake doctor
intake shipcheck
intake dashboard
intake eval run
```

## Dashboard

Start the dashboard:

```sh
intake dashboard --port 8787
```

The dashboard binds to `127.0.0.1`, prints a tokenized local URL, captures that launch token into session storage, removes it from the browser URL, and uses the same `.intake/` storage, policy, action, learning, and audit-log workflow as the CLI. Set `INTAKE_DASHBOARD_TOKEN` or pass `--token` if you want a stable local token. Non-local dashboard binding requires `--allow-non-local`, TLS cert/key options, and an explicit token with at least 20 characters.

The dashboard includes:

- Guided source setup and source management for email, file, webhook, Slack, GitHub, Jira, Linear, ClickUp, and manual sources.
- Settings and policy editing for local operators.
- Email readiness checks for config, IMAP, and SMTP.
- Persisted source health for last readiness test, last sync, and bounded test/sync history.
- Intake item review and queue/tag controls.
- Draft/action approval workflow.
- Learnings, rules, and audit views.
- Filterable approval audit summaries by operator, source, action type, status, and date, with CSV export.
- Policy dry-runs before approving or changing action gates.
- Per-source test/sync status with pending action feedback.
- Runtime dashboard token display and rotation.
- Runtime security posture display for local-only, HTTPS, and token source.
- Auto-action kill switch.

## Sources

Available adapters:

- `manual`: create items directly from the CLI.
- `file`: scan `.txt`, `.md`, `.json`, and `.eml` files from a local folder.
- `webhook`: run a localhost JSON webhook receiver with token validation.
- `slack`: run a signed Slack Events API receiver with URL verification.
- `github`: receive GitHub issue and pull request webhooks.
- `jira`: receive Jira issue webhooks.
- `linear`: receive Linear issue webhooks.
- `clickup`: receive ClickUp task webhooks.
- `email`: sync IMAP mailboxes and create IMAP Drafts for approved draft actions.

For multiple inboxes, add one source per inbox, for example `support-email`, `sales-email`, and `billing-email`, each with its own username, secret reference, default queue, and sync cadence.

For GitHub, Jira, Linear, or ClickUp, use the provider source type so Intake can normalize issue IDs, titles, bodies, project metadata, states, and provider tags. GitHub sources also accept `X-Hub-Signature-256` webhook signatures using the configured webhook secret. GitHub can also post approved `comment_issue` actions when the source has a repository and an API token reference.

List setup templates:

```sh
intake templates list
intake templates show slack-events
intake templates show github-webhook
```

## Slack Events Setup

Create a Slack source with the app signing secret stored outside config:

```sh
INTAKE_SLACK_SIGNING_SECRET="slack-signing-secret"

intake source add slack \
  --id slack-support \
  --name "Slack Support" \
  --password-env INTAKE_SLACK_SIGNING_SECRET \
  --path /slack/events \
  --port 8766 \
  --queue engineering
```

Run the receiver:

```sh
intake watch --source slack-support
```

Point the Slack Events API request URL at the printed local URL through your tunnel of choice. Intake verifies Slack request signatures, handles URL verification challenges, normalizes message events, stores raw payloads, and classifies resulting items.

## PrivateEmail Setup

PrivateEmail defaults:

- IMAP: `mail.privateemail.com:993`, SSL
- SMTP: `mail.privateemail.com:465`, SSL

Store the mailbox password in `.intake/.env`:

```sh
INTAKE_SUPPORT_EMAIL_PASSWORD="mailbox-password"
```

Then add the source:

```sh
intake source add email \
  --id support-email \
  --name "Support Email" \
  --username support@example.com \
  --password-env INTAKE_SUPPORT_EMAIL_PASSWORD \
  --queue support
```

Or use encrypted macOS Keychain storage:

```sh
security add-generic-password -s kujo-intake -a support@example.com -w "mailbox-password" -U

intake source add email \
  --id support-email \
  --name "Support Email" \
  --username support@example.com \
  --keychain-service kujo-intake \
  --keychain-account support@example.com \
  --queue support
```

Test before syncing:

```sh
intake source test support-email
```

`source test` verifies:

- `config`: required source settings are present and secure.
- `imap`: the inbox can be reached and authenticated.
- `smtp`: the outbound/draft transport can be reached and authenticated.

No email is sent by `source test`.

Source test and sync status are saved on the source record so operators can see the last readiness result and last sync count in the dashboard.

Email and `.eml` file sources store attachment metadata by default. Set `--quarantine-attachments` when adding a source, or enable Quarantine attachments in the dashboard source editor, to write attachment bytes into `.intake/raw/attachments/` and keep item records metadata-only. The dashboard shows attachment inventory and provides an explicit audited download control for quarantined files; Intake never opens or executes attachments automatically.

## Live Email Smoke Test

Use this path before relying on a live inbox:

```sh
intake doctor
intake source test support-email
intake sync support-email
intake items --source support-email
```

Then send a harmless fake support email to the mailbox, sync again, open the item in the dashboard, classify it, create a draft, approve it, and run it.

For email sources, a `draft_response` action appends a draft to the configured Drafts mailbox. Direct sending remains blocked by the default policy.

## Policy and Safety

The default policy blocks auto-send and requires human review for outbound behavior. High-risk legal, security, refund, and prompt-injection items are routed to review. The global auto-action kill switch is off by default:

```sh
intake auto-actions disable
```

Policy and safety docs:

- [Security model](docs/security-model.md)
- [Policy engine](docs/policy-engine.md)
- [Prompt-injection defense](docs/prompt-injection-defense.md)
- [Adapter authoring guide](docs/adapter-authoring.md)
- [Packaging decision and release gates](docs/packaging-decision.md)
- [Performance baselines](docs/performance-baselines.md)
- [End-to-end tutorial](docs/end-to-end-tutorial.md)
- [Why Intake showcases Kujo](docs/why-kujo-showcase.md)
- [Dashboard CSRF posture](docs/dashboard-csrf-posture.md)
- [Live provider validation](docs/live-provider-validation.md)
- [Attachment policy](docs/attachment-policy.md)
- [Restore drill](docs/restore-drill.md)
- [Example packs](docs/example-packs.md)
- [Next production readiness sweep](docs/next-production-readiness-sweep.md)

## Storage

All state lives under `.intake/` unless `INTAKE_DIR` or `--dir` is set.

Key folders:

- `.intake/config/`: sources, policies, rules, settings, agents.
- `.intake/items/`: normalized intake records.
- `.intake/actions/`: proposed, approved, blocked, rejected, and executed actions.
- `.intake/learnings/`: reviewed learning candidates.
- `.intake/raw/`: raw payload snapshots.
- `.intake/logs/`: audit, sync, normalize, classify, policy, actions, and errors logs.
- `.intake/backups/`: local backup archives created by `intake backup create`.

Records are written atomically. Logs are JSONL and redacted before write.

## Backup And Restore

Create a portable backup:

```sh
intake backup create
```

Verify a backup before relying on it:

```sh
intake backup verify .intake/backups/intake-backup-YYYYMMDDHHMMSS.json.gz
```

Restore into an empty target:

```sh
intake backup restore .intake/backups/intake-backup-YYYYMMDDHHMMSS.json.gz --target .intake-restored
```

Backups are gzipped JSON with a manifest, storage schema version, and SHA-256 checksum per file. Local secrets are excluded by default: `.intake/.env` and `.intake/secrets/` are not included unless `--include-secrets` is passed.

Keep only the latest N local backup archives:

```sh
intake backup create --keep 7
```

## Retention And Purge

Preview retention cleanup:

```sh
intake retention apply --raw-days 90 --logs-days 180 --dry-run
```

Apply retention cleanup:

```sh
intake retention apply --raw-days 90 --logs-days 180
```

Preview a safe item purge:

```sh
intake purge items --status resolved --before 2026-01-01 --dry-run
```

Apply a purge only after reviewing the dry run:

```sh
intake purge items --status resolved --before 2026-01-01 --force
```

Purging selected items also removes linked actions, linked learnings, and raw payloads for those items.

## Policy Preview

Preview whether an action would be allowed, blocked, require review, or fit inside auto-action budgets:

```sh
intake policy preview ITEM_ID draft_response
```

Sources can define `allowed_actions` to further restrict what that source may execute. Direct `send_response` stays blocked by the default policy.

## Operator Utilities

Show guided setup steps:

```sh
intake onboarding privateemail
intake onboarding slack
```

Clone a source as a disabled copy:

```sh
intake source clone support-email support-email-copy
```

Export configuration without local secrets:

```sh
intake config export --output intake-config.json
```

Import a reviewed config export:

```sh
intake config import intake-config.json --replace
```

## Demo Data

Seed a realistic email interaction:

```sh
intake demo seed email
```

Clear demo records:

```sh
intake demo clear
```

## Verification

Run the local quality gate:

```sh
npm run verify
npm run release:check
node bin/intake.js shipcheck
npm run bench -- --items 1000 --logs 10000 --fileRows 1000 --actions 1000 --learnings 1000
npm run bench -- --items 100 --logs 100000 --fileRows 0 --actions 0 --learnings 0 --dashboard false
```

The built-in test and eval suite covers routing and safety cases from the original build prompt, including refunds, legal threats, prompt injection, Slack-style bug reports, webhook payloads, generated high-volume sync dedupe, learning generation, dashboard policy previews, and auto-action policy checks. `npm run verify` also runs the benchmark gate so warm dashboard and repeated-sync latency regressions fail locally before release. `npm run release:check` adds shipcheck, doctor, and package dry-run checks on top of verify. `intake shipcheck` reports local release health plus external enterprise blockers such as live-source and remote-CI evidence.

## Project Structure

```text
bin/intake.js       CLI entrypoint
src/                Core app, adapters, workflow, dashboard, storage, policy
tests/              Unit and smoke tests
scripts/            Local benchmark and operator utility scripts
docs/               Architecture, setup, security, and roadmap docs
.github/            CI workflow definitions
.intake/            Local runtime state, ignored by git
```

There are no required root-level runtime files outside `bin/`, `src/`, `tests/`, `docs/`, `.github/`, `README.md`, `CHANGELOG.md`, `package.json`, and `package-lock.json`.


### Hardening and operational limits

The [repository hardening audit](docs/audits/repository-hardening.md) records the baseline, fixes, measurements, verification and remaining work.

Automatic execution requires a matching policy, sufficient confidence, no rule veto and no outstanding human-review requirement. Rejected actions stay rejected. Proposed rules do not affect classification until approved; legacy rules without a status remain active. Editing an approved action's body or type resets its approval.

Action execution is serialized per store, including across processes. Interrupted or failed execution is marked `executing` or `execution_uncertain`; reconcile the external effect before explicitly approving a retry. If `.action-lock` remains after a crash, stop writers and reconcile the affected actions before removing it. Automatic budgets reserve an attempt before execution and therefore include uncertain attempts. This prevents blind retries; it does not promise exactly-once delivery at external providers.

Use one writer process per store for general ingestion and configuration, and stop writers during backup, restore, retention and purge. Index updates and dashboard mutations are serialized within one process; the filesystem format does not provide general multi-process transactions.

Default backups omit inline `token`, `api_token` and `signing_secret` fields as well as `.env` and `secrets/`. Restore secret references through the environment or Keychain; use `--include-secrets` only when intentionally preserving inline credentials in a protected archive. Verification and restore limit decompressed archives to 256 MiB; `--max-bytes N` explicitly raises that limit for larger trusted archives. Restore validates and stages the complete store before replacing the destination. File-drop sources accept regular files and skip symbolic links.

`npm run bench:logs` measures a 200-row page from 100,000 audit events. It checks the returned rows and reports timings; the regular benchmark gate also covers log paging. Detailed log records remain available through pagination and the JSONL files.

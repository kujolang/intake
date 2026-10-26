# Changelog

## Unreleased

- Support subsequent five-prospect outreach batches with cross-batch copy review and separate resumable receipts. Use natural email subjects as Intake titles without campaign prefixes.

- Require versioned Ashford outreach copy review, sourced claims, 34/40 quality scores and campaign-wide distinctiveness checks before draft persistence.
- Revise existing campaign records with verified IMAP replacement, recoverable prior versions and fail-closed recovery journals; prevent dashboard edits from bypassing outreach review.

- Add a draft-only outreach campaign runner with explicit identity grouping, mailbox-wide history checks, account suppression holds, and resumable Intake review records.
- Preserve IMAP draft UID and Message-ID receipts and block campaign delivery at the email adapter.

All notable changes to Kujo Intake are tracked here.

This project follows a lightweight semantic versioning policy:

- Patch: bug fixes, documentation updates, test hardening, and backwards-compatible safety improvements.
- Minor: new adapters, CLI commands, dashboard features, and backwards-compatible storage additions.
- Major: storage schema changes that require migration, command contract breaks, or policy behavior changes that can affect operator safety.

## 0.3.0 — 2026-10-22

- Added the all-items inbox view and mailbox source filtering.
- Refined the dashboard theme and progressively disclosed secondary controls.
- Required patched Node.js release lines and expanded CI to Node 26.

## 0.2.0 — 2026-10-13

First tagged GitHub release. Distributed as Node.js source; not published to npm or Kennel.

- Added persistent receiver receipts so retries preserve reviewed items and operator changes.
- Added store locks, interrupted restore/config-import recovery, and validation that preserves corrupt metadata and records for inspection.
- Hardened automatic-action approval, rate budgets, credential handling, atomic exports, backups, retention, and bounded network/file reads.
- Streamed large log operations and added bounded-heap regressions.
- Added regression coverage for process interruptions, concurrent requests, failed writes, and malformed persisted state.
- Aligned package, CLI, README, and release versions; clarified installation and operating limits.


- Reworked the local dashboard around familiar Inbox, Later, Mine, Unassigned, Done, and Approvals workflows.
- Added persistent snooze and local-operator assignment actions, keyboard navigation, Quick commands, responsive inbox navigation, and simplified everyday settings.
- Added a non-mutating live email provider verification command and recorded successful IMAP/SMTP connection evidence.

## 0.1.0 — development baseline (untagged)

- Initial local-first Intake implementation.
- CLI, dashboard, storage, policy, rules, evals, demo seed, PrivateEmail adapter, webhook/file/manual adapters.
- Backup/restore, retention/purge, Slack Events receiver, source templates, and production-readiness hardening.

### Explicit reviewed outreach delivery

- Added a separate operator-authorized send runner bound to exact reviewed draft
  snapshots, with batch preflight, duplicate prevention, durable SMTP receipts,
  verified Sent copies, and recoverable draft archiving. Draft approval and the
  campaign dashboard still cannot send implicitly.

# Production Readiness Roadmap

This document captures the next meaningful work to make Kujo Intake a stronger showcase app and a more universally useful intake system.

Current status: Intake is ready for local-first live mailbox smoke testing, demo use, adapter development, and internal operator workflows. It is not yet an enterprise deployment package.

## Completed In The Latest Sweep

- Added safe record ID validation for item, action, learning, source, and raw payload paths.
- Hardened raw payload reads against path traversal.
- Added bounded request body parsing for the dashboard API.
- Added bounded request body parsing for webhook sources.
- Switched webhook token checks to constant-time comparison.
- Fixed webhook support for ephemeral port `0`, improving testability and embedding.
- Sanitized generated email draft/send headers against newline injection.
- Added regression tests for path safety, dashboard body limits, and webhook auth/body limits.
- Added `npm run verify` for the full local quality gate.
- Added storage schema metadata and doctor validation.
- Added `intake backup create`, `intake backup verify`, and `intake backup restore`.
- Added backup tests and CLI smoke coverage.
- Added persisted source readiness and sync status for CLI/dashboard operations.
- Added migration hooks for future storage schema changes.
- Added retention controls for raw payloads and logs.
- Added safe item purge with dry-run and forced execution modes.
- Added native signed Slack Events API receiver.
- Added source templates for PrivateEmail, Slack, GitHub, Jira, Linear, and ClickUp.
- Added adapter authoring guide.
- Added release checklist, packaging decision, changelog policy, and GitHub Actions verify workflow.
- Added IMAP/SMTP and Slack troubleshooting matrix.
- Added config import/export commands with secrets excluded by default.
- Added source clone command.
- Added `intake doctor --fix` for safe index repair.
- Added onboarding guides for PrivateEmail and Slack.
- Added terminal-friendly source test output with setup hints.
- Added lightweight dashboard first-run source setup panel.
- Added enterprise readiness checklist, end-to-end tutorial, and Kujo showcase docs.
- Added backup rotation with `intake backup create --keep N`.
- Added indexed and paginated item list reads for dashboard/API use.
- Added optional HTTPS support for explicitly non-local dashboard binding.
- Added dashboard CSRF posture documentation.
- Added source-save secret reference validation.
- Added realistic redaction tests for mail/webhook errors.
- Added attachment handling policy documentation.
- Added policy preview command.
- Added per-source action allowlists.
- Added auto-action rate counters.
- Added explicit send-disabled dashboard copy.
- Added bounded pagination for action, learning, and dashboard log list APIs.
- Added dashboard settings editing for auto-actions, AI enablement/provider, and export paths.
- Added dashboard policy editing with structured validation.
- Added native provider-aware issue webhook adapters for GitHub, Jira, Linear, and ClickUp.
- Added shared adapter contract tests for normalized intake items.
- Added benchmark harness for large local stores, audit logs, and repeated sync dedupe.
- Added restore drill documentation.
- Expanded agent-facing docs with stable records, allowed operations, and blocked operations.
- Added example packs for agencies, SaaS support, solo founders, and internal ops.
- Verified dashboard Settings and Sources screens in-browser with no console errors.
- Reworked the README into a clearer showcase and operator guide.

## P0: Live Source Confidence

- Run a real PrivateEmail smoke test using a test mailbox.
- Verify `source test` passes config, IMAP, and SMTP.
- Verify `sync` pulls new messages without duplicating existing ones.
- Verify approved `draft_response` appends to the remote Drafts mailbox.
- Verify direct `send_response` remains blocked by default policy.
- Add a live-source transcript to docs after a disposable mailbox test passes.

## P0: Packaging And Distribution

- Remove `"private": true` only after package metadata, license, publish workflow, and release policy are ready.
- Run the GitHub Actions workflow once the project is inside a Git worktree and remote repository.

## P0: Data Lifecycle

- Add restore drill operator screenshots after the restored dashboard flow is captured.

## P1: Dashboard Completeness

- Deepen first-run setup into a full guided wizard:
  - configure secrets
  - run readiness test
  - send/sync first test item
- Add screenshots for empty states after demo data is removed.
- Add detail views for source test history and last sync status.
- Add per-source sync buttons with spinner/error state.
- Add dashboard token rotation/display controls.
- Add accessibility checks to the smoke flow.

## P1: Adapter Expansion

- Add provider signature verification where each issue tracker offers stable signing headers.
- Add remote writeback actions for providers where appropriate, such as comments or labels, behind human approval gates.

## P1: Policy And Approvals

- Add dashboard policy dry-run controls for proposed actions.
- Add approval audit views by operator and action type.

## P1: Performance

- Add incremental index updates for item status/queue/tag changes.
- Add large mailbox sync tests using generated fixtures.
- Run benchmark scripts and publish baseline timings for 1k items, 10k items, 100k log lines, and repeated sync dedupe.

## P1: Security

- Add optional attachment quarantine after metadata-only policy is validated.

## P2: AI And Language Showcase

- Decide how Intake should demonstrate the Kujo language/runtime directly:
  - embed Kujo scripts for policies
  - use Kujo workflow definitions for adapter orchestration
  - expose Intake as a Kujo example package
  - add side-by-side JavaScript and Kujo examples where useful

## P2: Operator Experience

- Expand terminal explainers as new adapters add provider-specific failure modes.

## P2: Documentation Polish

- Add screenshots or an animated walkthrough after the dashboard stabilizes.
- Add screenshots or an animated walkthrough after live-source validation.

## Suggested Next Session

Start with:

1. Deepen dashboard first-run setup into a guided wizard.
2. Run a real PrivateEmail smoke test with a disposable mailbox.
3. Add restore drill screenshots.
4. Add source health history and per-source sync progress to the dashboard.
5. Run CI/release packaging once this project is inside a Git worktree.

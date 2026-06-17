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
- Added dashboard policy dry-run controls for proposed actions.
- Added approval audit summaries by operator and action type.
- Added native provider-aware issue webhook adapters for GitHub, Jira, Linear, and ClickUp.
- Added shared adapter contract tests for normalized intake items.
- Added benchmark harness for large local stores, audit logs, and repeated sync dedupe.
- Added incremental item index updates for item save/delete paths.
- Added generated high-volume source sync fixture tests with repeated sync dedupe coverage.
- Added per-source dashboard pending states for test/sync actions and richer last-sync detail.
- Added bounded source test/sync history on source records and dashboard detail views.
- Added runtime dashboard token display and rotation controls.
- Added guided dashboard first-source setup with PrivateEmail, Slack, GitHub, and Manual presets plus saved-source readiness checklist.
- Added dashboard accessibility assertions for icon-only controls and operator tabs.
- Added GitHub webhook HMAC signature verification for issue intake.
- Added optional attachment quarantine for email/file `.eml` sources.
- Hardened email source readiness checks so provider socket errors report cleanly instead of crashing the CLI.
- Added GitHub issue comment writeback for approved `comment_issue` actions behind source policy and human approval gates.
- Added package author, repository, bug tracker, homepage, publish files, and public publish metadata while keeping `"private": true`.
- Added compact item index dedupe keys and skipped full index rebuilds on no-op source syncs.
- Published local performance baselines in [performance-baselines.md](performance-baselines.md).
- Added restore drill documentation.
- Expanded agent-facing docs with stable records, allowed operations, and blocked operations.
- Added example packs for agencies, SaaS support, solo founders, and internal ops.
- Verified dashboard Settings, Sources, policy dry-run, and Actions approval audit screens in-browser with no console errors.
- Reworked the README into a clearer showcase and operator guide.

## P0: Live Source Confidence

- Run a real PrivateEmail smoke test using a test mailbox.
- Verify `source test` passes config, IMAP, and SMTP.
- Verify `sync` pulls new messages without duplicating existing ones.
- Verify approved `draft_response` appends to the remote Drafts mailbox.
- Verify direct `send_response` remains blocked by default policy.
- Add a live-source transcript to docs after a disposable mailbox test passes.

## P0: Packaging And Distribution

- Keep `"private": true` until live-source gates and remote CI are proven.
- Run the GitHub Actions workflow in the remote repository and capture the result before tagging or publishing.

## P0: Data Lifecycle

- Add restore drill operator screenshots after the restored dashboard flow is captured.

## P1: Dashboard Completeness

- Add a live-first-sync walkthrough after disposable mailbox credentials are available.
- Add screenshots for empty states after demo data is removed.
- Expand accessibility checks into a browser-driven smoke flow.

## P1: Adapter Expansion

- Add additional provider signature verification where Jira, Linear, or ClickUp offer stable signing headers.
- Add remote writeback actions for Jira, Linear, and ClickUp where appropriate, such as comments or labels, behind human approval gates.

## P1: Policy And Approvals

- Add deeper approval audit filters and export by operator, source, and action type.

## P1: Performance

- Add dashboard API warm-index latency measurements.
- Decide whether actions and learnings need compact indexes like items.
- Add 100k audit log baseline in a longer-running benchmark job.

## P1: Security

- Add attachment quarantine dashboard review/restore controls after operator flow is designed.

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

1. Run a real PrivateEmail smoke test with a disposable mailbox.
2. Capture the guided dashboard setup path using the disposable mailbox.
3. Add restore drill screenshots.
4. Add source health history beyond latest status and capture operator screenshots.
5. Run CI/release packaging in the remote repository and capture the result.

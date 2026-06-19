# Intake Next Enterprise Readiness Review · 2026-06-19

This is the next-session work queue after the 2026-06-19 codebase review. Intake is a strong local-first showcase and operator tool, but it should not be marketed as universally enterprise-ready until live-source, packaging, release, and deployment evidence are captured.

## Current Posture

- Strong: local-first storage, deterministic policy gates, redacted audit logs, source adapters, dashboard workflows, backup/restore, retention, shipcheck, benchmark gate, and broad test coverage.
- Improved in this pass: warm index reads avoid per-request re-sorting, the dashboard removes tokenized launch credentials from the browser URL after session capture, and the email dependency lockfile was refreshed so `npm audit --audit-level=high` reports zero vulnerabilities.
- Still not universal enterprise proof: live mailbox validation, remote CI evidence, signed release process, malware scanning, provider-specific writeback expansion, and organization-specific deployment controls remain open.

## Root Layout Review

Tracked root files are intentional:

- `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, and `package-lock.json` are release/package metadata.
- `.github/` contains CI workflow definitions.
- `bin/intake.js` is the executable CLI shim.
- `src/` contains the implementation.
- `tests/` contains unit and smoke coverage.
- `scripts/` contains benchmark/operator utilities.
- `docs/` contains architecture, setup, safety, release, and roadmap documentation.

Ignored local files observed during review are expected:

- `.intake/` is runtime state and may contain local `.env` values.
- `node_modules/` is dependency installation output.

No tracked root files need to be moved into `src/` at this time.

## P0: External Proof Before Enterprise Claims

- Run the live PrivateEmail smoke path with a disposable mailbox:
  - `intake doctor`
  - `intake source test SOURCE_ID`
  - `intake sync SOURCE_ID` twice
  - approved `draft_response`
  - verify remote Drafts append
  - verify `send_response` remains blocked
- Capture a redacted live-source transcript in docs.
- Run the remote GitHub Actions verify workflow after billing/spending-limit settings allow jobs to start.
- Run `npm run release:check` in an environment with normal Node/npm on PATH and preserve the full output.
- Run `npm pack --dry-run` and compare package contents against `docs/release-checklist.md`.

## P0: Packaging And Security Gate

- Decide whether and when to remove `"private": true`.
- Add security contact/reporting guidance before public distribution.
- Document a release signing or provenance policy.
- Decide whether dashboard URL token launch remains acceptable for local-only use, or add a one-time local token exchange endpoint before broader distribution.
- Add a regression test that executes the dashboard token-scrub script in a browser-like DOM, not only static HTML assertions.

## P1: Dashboard And Operator Evidence

- Capture empty dashboard screenshots after demo data is cleared.
- Capture guided source setup screenshots with a disposable mailbox.
- Add browser-driven accessibility smoke checks for desktop and mobile widths.
- Add a restore drill evidence bundle with terminal output or screenshots.
- Add signed approval report bundles after release-signing policy is decided.

## P1: Adapter And Writeback Expansion

- Add provider-native signature verification for Jira, Linear, and ClickUp where stable signing headers are available.
- Add approved comment/label writeback actions for Jira, Linear, and ClickUp where appropriate.
- Add a live GitHub writeback smoke test against a disposable issue.
- Keep every remote write behind policy preview, human approval, and audit logs.

## P1: Attachment And Data Controls

- Add malware scanning hooks for quarantined attachments after operator policy is defined.
- Add role-separated release controls for attachment download/export paths.
- Add operator guidance for encrypted backup storage when `--include-secrets` is intentionally used.
- Add longer-duration trend checks for audit-log growth and backup/restore timing.

## P2: Kujo Showcase Depth

- Decide how Intake should demonstrate Kujo directly:
  - policy packs as Kujo scripts
  - adapter orchestration as Kujo workflows
  - Intake as a Kujo example package
  - side-by-side JavaScript and Kujo examples
- Add a concise architecture walkthrough aimed at new Kujo users.
- Add a visual architecture diagram once the live-source flow is captured.

## Suggested Next Session

Start with the live PrivateEmail proof path if credentials are available. If not, start with the dashboard token browser-execution regression test and remote CI/package evidence, because those are local or account-configuration bounded and reduce release risk without requiring customer data.

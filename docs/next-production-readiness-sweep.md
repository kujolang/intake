# Next Production Readiness Sweep

This is the next-session work queue after the latest local verification sweep. Intake is stronger, but it should not be described as enterprise deployment-ready until the external validation items are finished.

## P0: Prove Live Email

- Create or use a disposable PrivateEmail mailbox.
- Add the mailbox as an `email` source using `.intake/.env` or macOS Keychain.
- Run `intake doctor`.
- Run `intake source test SOURCE_ID` and capture config, IMAP, and SMTP readiness.
- Send a harmless test email to the mailbox.
- Run `intake sync SOURCE_ID` twice and verify the second sync does not duplicate the message.
- Create, approve, and run a `draft_response` action.
- Confirm the approved draft is appended to the remote Drafts mailbox.
- Confirm direct `send_response` remains blocked by default policy.
- Add a redacted live-source transcript to docs.

## P0: Package And CI

- Decide whether this package is ready to remove `"private": true`.
- Reconfirm package metadata before release: author, repository, homepage, bugs, license, bin, files, engines, publish config, and changelog.
- Run the GitHub Actions verify workflow in the remote repository after GitHub billing/spending-limit settings allow jobs to start.
- Run `npm pack --dry-run` and compare package contents against the release checklist.
- Confirm root files are intentional: `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `package-lock.json`, `.github/`, `bin/`, `src/`, `tests/`, `scripts/`, and `docs/`.

## P0: Operator Evidence

- Capture restore drill screenshots or terminal captures.
- Capture empty-dashboard screenshots after demo data is cleared.
- Capture the guided dashboard source setup walkthrough with a disposable mailbox.

## P1: Dashboard

- Add a live-first-sync checklist state after disposable mailbox credentials are available.
- Add browser-driven accessibility smoke checks for desktop and mobile widths.
- Add signed approval report bundles after release signing policy is decided.

## P1: Security

- Add malware scanning and role-separated release controls for quarantined attachments after operator policy is defined.
- Add provider-native signature verification for Jira, Linear, and ClickUp where the provider offers stable signing headers.

## P1: Provider Writeback

- Add approved comment or label actions for Jira/Linear/ClickUp where appropriate.
- Add a live GitHub writeback smoke test against a disposable issue.
- Keep every remote write behind policy preview, human approval, and audit logs.
- Add provider-specific troubleshooting hints for failed writeback actions.

## P1: Performance Evidence

- Add longer-duration trend checks for audit-log growth and backup/restore timing.

## P2: Kujo Language Showcase

- Decide how Intake should demonstrate Kujo directly:
  - policy packs as Kujo scripts
  - adapter orchestration as Kujo workflows
  - Intake as a Kujo example package
  - side-by-side JavaScript and Kujo examples
- Add a concise architecture walkthrough aimed at new Kujo users.

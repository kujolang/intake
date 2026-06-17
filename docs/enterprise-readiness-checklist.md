# Enterprise Readiness Checklist

Use this checklist to decide whether a specific Intake deployment is enterprise-ready.

## Required For Any Production Deployment

- `npm run verify` passes on the release artifact, including tests, smoke, evals, benchmark gate, and audit.
- `npm run release:check` passes before any release tag or package publish.
- `intake doctor` passes for the target `.intake/` store.
- Every enabled source passes `intake source test SOURCE_ID`.
- Backups are created, verified, restored in a drill, and stored outside the app host.
- Retention rules are documented and tested with `--dry-run`.
- Operators know how to use `intake purge items` safely.
- Dashboard remains localhost-only unless HTTPS, auth, and deployment controls are explicitly reviewed.
- Secrets are referenced by `env:` or Keychain, not stored directly in source config.
- Default policy still blocks direct `send_response`.
- Audit/error logs are reviewed during launch.

## Required For Shared Team Use

- CI runs `npm run verify`, including the benchmark gate.
- Release checklist passes.
- Changelog is current.
- Backup and restore ownership is assigned.
- Source ownership is assigned per inbox/channel/system.
- Policy changes have a review process.
- Data retention has an owner and schedule.
- Incident response includes source disable, auto-action disable, backup restore, and log review.

## Required Before Public Distribution

- Package decision is updated.
- Support and security contact policy is documented.
- License and repository metadata are final.
- Live PrivateEmail smoke test passes.
- Live Slack smoke test passes.
- At least one restore drill is documented.
- Dashboard first-run flow is complete.

## Current Project Status

Intake is a production-grade local-first foundation and showcase app, but not a certified enterprise deployment by itself. Enterprise readiness is deployment-specific and requires the gates above to pass with real sources and real operator procedures.

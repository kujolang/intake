# Changelog

All notable changes to Kujo Intake are tracked here.

This project follows a lightweight semantic versioning policy:

- Patch: bug fixes, documentation updates, test hardening, and backwards-compatible safety improvements.
- Minor: new adapters, CLI commands, dashboard features, and backwards-compatible storage additions.
- Major: storage schema changes that require migration, command contract breaks, or policy behavior changes that can affect operator safety.

## Unreleased

- Reworked the local dashboard around familiar Inbox, Later, Mine, Unassigned, Done, and Approvals workflows.
- Added persistent snooze and local-operator assignment actions, keyboard navigation, Quick commands, responsive inbox navigation, and simplified everyday settings.
- Added a non-mutating live email provider verification command and recorded successful IMAP/SMTP connection evidence.

## 0.1.0

- Initial local-first Intake implementation.
- CLI, dashboard, storage, policy, rules, evals, demo seed, PrivateEmail adapter, webhook/file/manual adapters.
- Backup/restore, retention/purge, Slack Events receiver, source templates, and production-readiness hardening.

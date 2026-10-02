# Packaging Decision

Current decision: keep Kujo Intake private while it is being hardened as a showcase app and local-first reference implementation.

## Why `private: true` Remains

- Live PrivateEmail and Slack smoke tests still need to be completed with disposable real accounts.
- Remote CI is passing on Node 20.19, 22, and 24 with the Chromium browser test; release evidence must still be checked for the revision being published.
- Storage migration hooks exist, but there has not yet been a real schema migration.
- Dashboard first-run onboarding is not complete.
- GitHub has provider-aware webhook intake and approved comment writeback, but Jira, Linear, and ClickUp still need provider-native writeback actions.

## Intended Distribution Path

1. Internal showcase app and local operator tool.
2. Public example repository once CI/release gates are proven.
3. npm package or Kujo package after live-source gates and support expectations are finalized.
4. Optional bundled binary only if non-Node operators become a target audience.

## Publish Preconditions

- `npm run verify` passes.
- `npm run release:check` passes.
- `intake shipcheck` has no local failures and external blockers are satisfied with evidence.
- Release checklist passes.
- `CHANGELOG.md` has a current entry.
- `README.md` reflects the actual release state.
- Live email and Slack smoke tests are completed.
- Remote CI has passed on the branch intended for release.
- `node scripts/check-package.mjs` passes, proving every archived file is tracked and intentionally reviewable; local audit command transcripts remain excluded.
- Support and security contact expectations are documented.

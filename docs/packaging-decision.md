# Packaging Decision

Current decision: keep Kujo Intake private while it is being hardened as a showcase app and local-first reference implementation.

## Why `private: true` Remains

- Live PrivateEmail and Slack smoke tests still need to be completed with disposable real accounts.
- CI can be defined, but this folder is not currently a Git worktree.
- Storage migration hooks exist, but there has not yet been a real schema migration.
- Dashboard first-run onboarding is not complete.
- Native adapter coverage is starting with Slack, but other systems still use generic webhook templates.

## Intended Distribution Path

1. Internal showcase app and local operator tool.
2. Public example repository once CI/release gates are proven.
3. npm package or Kujo package after package metadata and support expectations are finalized.
4. Optional bundled binary only if non-Node operators become a target audience.

## Publish Preconditions

- `npm run verify` passes.
- Release checklist passes.
- `CHANGELOG.md` has a current entry.
- `README.md` reflects the actual release state.
- Live email and Slack smoke tests are completed.
- The repository is inside a Git worktree with CI enabled.
- Support and security contact expectations are documented.

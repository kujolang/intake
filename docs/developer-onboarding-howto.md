# Developer Onboarding HOWTO

This guide is for developers joining the Intake codebase. It covers the local setup, core architecture, development workflow, verification gates, and the operational rules that keep Intake safe while it handles real inbound business data.

## 1. Prerequisites

Install:

- Node.js 20.19.0 or newer.
- npm.
- Git.
- Optional: macOS Keychain CLI (`security`) if you are testing local encrypted secret references.

The project is an ESM Node application. There is no build step. Source files run directly through Node.

Check your local versions:

```sh
node --version
npm --version
git --version
```

## 2. Clone And Install

```sh
git clone git@github.com:kujolang/intake.git
cd intake
npm install
```

Optional global CLI link:

```sh
npm link
intake --help
```

Without `npm link`, use:

```sh
node bin/intake.js --help
```

## 3. Initialize Local Runtime State

Intake stores local runtime state under `.intake/`. This folder is ignored by git and may contain live mailbox metadata, raw inbound payloads, audit logs, actions, learnings, and local secrets.

Initialize it:

```sh
node bin/intake.js init
```

Expected directories include:

```text
.intake/config/
.intake/items/
.intake/actions/
.intake/learnings/
.intake/index/
.intake/logs/
.intake/raw/
.intake/strata/
.intake/totalrecall/
```

Do not commit `.intake/`.

## 4. Start With A Safe Manual Flow

Use the manual source before connecting live inboxes or webhooks.

```sh
node bin/intake.js source add manual --id manual --name Manual
node bin/intake.js item create --title "Refund request" --body "Please refund my payment." --queue support
node bin/intake.js items
node bin/intake.js classify ITEM_ID
node bin/intake.js draft ITEM_ID
node bin/intake.js actions
```

Typical action flow:

```sh
node bin/intake.js approve ACTION_ID
node bin/intake.js run ACTION_ID
```

Default policy blocks direct sends and requires human approval for outbound work.

## 5. Run The Dashboard

```sh
node bin/intake.js dashboard --port 8787
```

The dashboard prints a tokenized local URL:

```text
Dashboard: http://127.0.0.1:8787/?token=...
```

Dashboard defaults:

- Binds to `127.0.0.1`.
- Requires an API token.
- Uses `.intake/` for runtime state.
- Provides source setup, item review, action approval, rules, settings, audit logs, and source diagnostics.

For stable local dashboard URLs, set:

```sh
export INTAKE_DASHBOARD_TOKEN="a-long-local-development-token"
node bin/intake.js dashboard --port 8787
```

## 6. Repository Layout

```text
bin/intake.js          CLI entrypoint.
src/cli.js            CLI command routing.
src/dashboard.js      Local dashboard HTTP server and browser UI.
src/workflow.js       Sync, classify, draft, approve, run, learn workflow.
src/storage.js        Atomic JSON storage, indexes, defaults.
src/models.js         Source, item, action, learning constructors.
src/rules.js          Deterministic routing rules.
src/safety.js         Prompt-injection, secret, legal, refund, link checks.
src/policy.js         Action approval and auto-execution gates.
src/ai.js             OpenAI-compatible classification provider support.
src/adapters/         Source adapters and writeback integrations.
src/exports.js        Strata and TotalRecall export writers.
tests/                Unit, integration, dashboard, lifecycle, smoke tests.
scripts/              Benchmark and threshold utilities.
docs/                 Architecture, setup, security, operations docs.
```

## 7. Core Runtime Model

Intake normalizes every inbound signal into this flow:

```text
Source -> Adapter -> Raw payload -> IntakeItem -> Rules/Safety -> AI -> Queue -> Action -> Approval -> Audit -> Export
```

Key records:

- `Source`: where data comes from, such as email, Slack, GitHub, file, or manual input.
- `IntakeItem`: normalized inbound unit of work.
- `Action`: proposed or approved operation, such as drafting a response or marking an item resolved.
- `Learning`: reviewable knowledge artifact for Strata or TotalRecall export.
- `Policy`: action gate that determines allowed, blocked, approval-required, and auto-executable actions.
- `Rule`: deterministic classifier that sets queue, risk, category, intent, tags, and suggested actions.

## 8. Source Adapters

Adapters live under `src/adapters/`.

Current source families:

- `manual`
- `file`
- `email`
- `webhook`
- `slack`
- `github`
- `jira`
- `linear`
- `clickup`

Adapter responsibilities:

- Read source-specific payloads.
- Store raw payloads when appropriate.
- Return normalized `IntakeItem` records.
- Preserve source-native IDs for dedupe.
- Avoid executing remote side effects during sync.

Writeback responsibilities, where supported:

- Validate destination metadata.
- Respect policy gates.
- Execute only approved action types.
- Log result details without leaking secrets.

Read:

- [Source adapters](source-adapters.md)
- [Adapter authoring](adapter-authoring.md)

## 9. Rules, Safety, AI, And Policy

The classification order is important:

1. Deterministic rules run first.
2. Safety checks run next.
3. AI may enrich the item if enabled.
4. AI cannot downgrade deterministic or safety risk.
5. Policy gates action execution.

Rules can set:

- `queue`
- `risk_level`
- `category`
- `intent`
- `tags`
- `suggested_actions`
- `blocked_actions`

Safety checks detect:

- Prompt injection.
- Secret extraction.
- Suspicious links.
- Legal threats.
- Payment or refund requests.

Policy controls:

- Whether an action type is allowed.
- Whether it is blocked.
- Whether human approval is required.
- Whether auto-execution is permitted.
- Risk ceiling and confidence threshold.
- Auto-action rate limits.

Read:

- [Security model](security-model.md)
- [Policy engine](policy-engine.md)
- [Prompt-injection defense](prompt-injection-defense.md)

## 10. AI Provider Development

AI classification is optional. The provider path is OpenAI-compatible and configured through runtime settings.

Common env values:

```sh
DEEPSEEK_API_KEY="..."
OPENAI_API_KEY="..."
OPENROUTER_API_KEY="..."
```

AI settings are stored in `.intake/config/settings.json`; secrets should stay in environment variables, `.intake/.env`, `.env`, or Keychain references.

Do not store API keys in source config or committed files.

When changing AI behavior:

- Keep deterministic rules and safety checks authoritative.
- Preserve prompt-injection boundaries.
- Add tests with mocked `fetch`.
- Do not make tests depend on live AI providers.

Relevant files:

```text
src/ai.js
src/workflow.js
tests/ai.test.js
tests/core.test.js
```

## 11. Email Development

Email support uses IMAP for sync and SMTP for draft/writeback readiness.

PrivateEmail defaults:

```text
IMAP: mail.privateemail.com:993 SSL
SMTP: mail.privateemail.com:465 SSL
```

Use env-backed secrets:

```sh
INTAKE_SUPPORT_EMAIL_PASSWORD="mailbox-password"
```

Add a source:

```sh
node bin/intake.js source add email \
  --id support-email \
  --name "Support Email" \
  --username support@example.com \
  --password-env INTAKE_SUPPORT_EMAIL_PASSWORD \
  --queue support
```

Test before syncing:

```sh
node bin/intake.js source test support-email
```

Sync:

```sh
node bin/intake.js sync support-email
```

Read:

- [PrivateEmail setup](email-privateemail-setup.md)
- [End-to-end tutorial](end-to-end-tutorial.md)

## 12. Development Workflow

Before editing:

```sh
git status --short
```

Use focused tests while developing:

```sh
node --test tests/dashboard.test.js
node --test tests/core.test.js
node --test tests/email.test.js
```

Run the normal local gate before handoff:

```sh
npm run lint
npm test
npm run smoke
```

Run the full release-style gate before packaging or major refactors:

```sh
npm run verify
npm run release:check
```

`npm run verify` runs:

- Syntax checks.
- Test suite.
- Smoke flow.
- Eval suite.
- Benchmark threshold gate.
- High-severity npm audit.

## 13. Adding A CLI Command

CLI entrypoint:

```text
bin/intake.js
```

Command routing:

```text
src/cli.js
```

Expected pattern:

1. Parse args with existing helpers.
2. Call `initStore(root)` before storage operations.
3. Use workflow/storage helpers instead of direct file writes.
4. Print machine-readable JSON when `--json` exists.
5. Keep command errors explicit.
6. Add smoke or unit coverage.

## 14. Adding Dashboard Behavior

Dashboard server and browser UI live in one file:

```text
src/dashboard.js
```

Expected pattern:

1. Add an API route in `routeApi`.
2. Add a small server helper for validation and persistence.
3. Log meaningful audit/action/policy events.
4. Add browser UI controls in `dashboardHtml`.
5. Keep controls token-authenticated through `api()`.
6. Add dashboard tests in `tests/dashboard.test.js`.

Dashboard APIs should:

- Return JSON only.
- Enforce request body size limits.
- Require token auth except `/healthz` and the HTML shell.
- Avoid exposing secrets.
- Use `httpError(status, message)` for client errors.

## 15. Adding A Rule

Rules are stored in:

```text
.intake/config/rules.json
```

Default rules are defined in:

```text
src/storage.js
```

Add/edit rules through the dashboard Rules tab, or update JSON in tests/fixtures where appropriate.

Rule shape:

```json
{
  "id": "bug-engineering",
  "version": 1,
  "description": "Bug language routes to engineering.",
  "match_any": ["bug", "broken", "not working"],
  "tags": ["bug-report"],
  "category": "bug",
  "intent": "bug_report",
  "queue": "engineering",
  "risk_level": "medium",
  "suggested_actions": ["check_release_regression", "draft_response"]
}
```

Rule quality requirements:

- Use specific match terms.
- Avoid broad terms that route unrelated messages.
- Prefer deterministic high-risk routing for legal, security, credential, refund, and prompt-injection content.
- Add tests for new safety-sensitive rules.

## 16. Adding An Action Type

Action creation uses:

```text
src/models.js
src/workflow.js
src/policy.js
src/adapters/
```

When adding an action type:

1. Define the action behavior in workflow or an adapter executor.
2. Add the action type to policy defaults only if it is safe.
3. Decide whether approval is always required.
4. Add policy preview coverage.
5. Add run-action coverage.
6. Log execution and blocked states.

Never bypass `evaluatePolicy`.

## 17. Adding A Source Adapter

Recommended steps:

1. Add adapter implementation under `src/adapters/`.
2. Register it in `src/adapters/index.js`.
3. Add source config validation in `src/source-config.js`.
4. Add onboarding/template text if operators need setup guidance.
5. Add tests for readiness, sync, dedupe, and auth failures.
6. Add docs for required secrets and source fields.

Adapter sync must be idempotent. Repeated syncs with no new remote data should not create duplicate items.

## 18. Local Storage Rules

Use storage helpers:

- `saveItem`
- `saveAction`
- `saveLearning`
- `saveSources`
- `saveRules`
- `saveSettings`

Do not write JSON records directly from feature code. Storage helpers provide atomic writes and index maintenance.

When adding indexed fields, update:

- Compact row builder in `src/storage.js`.
- List/filter helpers.
- Tests covering pagination/filter behavior.

Read:

- [Local storage](local-storage.md)

## 19. Secrets And Redaction

Allowed secret patterns:

- Environment variable references.
- `.intake/.env` for local development.
- `.env` for local development.
- macOS Keychain references.

Disallowed:

- Storing API keys in source config.
- Logging raw passwords or tokens.
- Committing `.intake/`.
- Including live secrets in fixtures.

Run:

```sh
node bin/intake.js doctor
```

`doctor` checks store folders, schema metadata, policies, source readiness, secret references, and basic redaction posture.

## 20. Backup, Restore, Retention, And Purge

Create backup:

```sh
node bin/intake.js backup create --keep 7
```

Verify backup:

```sh
node bin/intake.js backup verify BACKUP_PATH
```

Restore into a separate target:

```sh
node bin/intake.js backup restore BACKUP_PATH --target RESTORE_DIR
```

Preview purge:

```sh
node bin/intake.js purge items --status resolved --before 2026-01-01 --dry-run
```

Apply purge:

```sh
node bin/intake.js purge items --status resolved --before 2026-01-01 --force
```

Retention:

```sh
node bin/intake.js retention apply --raw-days 90 --logs-days 180 --dry-run
```

Read:

- [Restore drill](restore-drill.md)

## 21. Evals And Benchmarks

Run evals:

```sh
node bin/intake.js eval run
```

Run benchmark gate:

```sh
npm run bench:gate
```

Run custom benchmark:

```sh
npm run bench -- --items 1000 --logs 10000 --fileRows 1000 --actions 1000 --learnings 1000
```

Use benchmarks when changing:

- Storage indexes.
- Sync dedupe.
- Dashboard list APIs.
- Log reads.
- Large generated source behavior.

Read:

- [Evals](evals.md)
- [Performance baselines](performance-baselines.md)

## 22. Common Troubleshooting

Dashboard says unauthorized:

- Open the exact tokenized URL printed by `intake dashboard`.
- If using a stable token, confirm `INTAKE_DASHBOARD_TOKEN`.

Email source test fails IMAP:

- Verify username is the mailbox address.
- Use mailbox password, not hosting account password.
- Confirm host, port, and SSL.
- Check VPN/firewall/provider status.

Email sync imports nothing:

- Run `source test` first.
- Confirm the source is enabled.
- Check `.intake/logs/errors.jsonl`.
- Verify the source cursor has not already advanced past the test message.

AI does not run:

- Confirm `ai_enabled` is true.
- Confirm provider, base URL, model, and API key env.
- Confirm the API key env is loaded by the dashboard process.
- Restart the dashboard after changing `.env` files.

Action will not run:

- Check policy preview.
- Approve the action first.
- Confirm the action type is allowed.
- Confirm source-specific allowed actions do not block it.

Read:

- [Troubleshooting](troubleshooting.md)

## 23. Pull Request Checklist

Before opening or merging a change:

- `git status --short` only shows intended files.
- New behavior has focused tests.
- `npm run lint` passes.
- `npm test` passes.
- `npm run smoke` passes for user-facing workflow changes.
- Docs are updated when commands, setup, security, or operator workflow changes.
- No secrets, `.intake/` data, local screenshots, or generated runtime artifacts are committed.
- Security-sensitive changes include policy/safety tests.
- Dashboard changes include API tests and HTML/UI hook checks where practical.
- Performance-sensitive changes run the benchmark gate.

## 24. Release Readiness

Before a release-style handoff:

```sh
npm run verify
npm run release:check
node bin/intake.js shipcheck
```

Review:

- [Packaging decision and release gates](packaging-decision.md)
- [Next production readiness sweep](next-production-readiness-sweep.md)

## 25. First-Day Task List

For a new developer, complete this sequence:

1. Install dependencies with `npm install`.
2. Run `node bin/intake.js init`.
3. Add a manual source.
4. Create and classify a manual item.
5. Start the dashboard.
6. Create a draft action.
7. Approve and run the action.
8. Create a rule in the dashboard.
9. Run `npm run lint`.
10. Run `npm test`.
11. Read `src/workflow.js`, `src/storage.js`, `src/dashboard.js`, and `src/adapters/index.js`.
12. Read the security and policy docs before touching action execution or source writeback.

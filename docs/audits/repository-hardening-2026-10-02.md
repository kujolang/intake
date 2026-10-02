# Intake repository hardening audit — 2026-10-02

Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `47ce999db1855f42473061a8b3c8ca786fabf15b`. Ending implementation SHA: `7ea0d8f`. The report commit follows the implementation commits and therefore cannot embed its own SHA.

## Repository and scope

Intake is a local-first Node.js CLI and authenticated dashboard for receiving business messages, normalizing and classifying them, gating actions, and exporting reviewed learnings. Runtime integrations are IMAP/SMTP, OpenAI-compatible providers, signed/token-authenticated webhooks, GitHub comments, Strata, and TotalRecall. The review covered runtime modules, adapters, public CLI/dashboard contracts, persistence and lock behavior, resource bounds, dependencies, tests, benchmarks, CI/release wiring, agent-facing documentation, and the prior hardening/security evidence.

The repository already contained two extensive hardening passes. This pass re-established the current baseline, reviewed the remaining high-risk boundaries and failure paths, refreshed dependency evidence, and made only new high-confidence changes. No sibling repository was modified.

## Baseline

At the starting SHA, the 102-test suite, smoke test, 21 evals, syntax lint, and performance thresholds passed. `npm run verify` failed at its final supply-chain gate because direct `nodemailer@9.1.1` was affected by five advisories consolidated by npm as one high-severity vulnerability. The baseline audit counted 52 production packages and 54 total packages.

The coverage run reported 85.75% lines, 73.11% branches, and 85.35% functions. Coverage was used as review guidance rather than a new brittle percentage ratchet. The current benchmark gate measured representative local JSON/JSONL operations and dashboard reads; all existing latency budgets passed.

The Codex Security Deep Scan plugin was invoked for a fresh whole-repository scan but refused to start because this host did not provide its required managed filesystem permission profile. No scan result or no-findings claim was fabricated. Security review therefore used direct current-source inspection, dependency audit, regression tests, and the repository's existing sealed security artifacts as historical context.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
|---|---|---|---|---|---|---|
| R01 | P1 | Supply chain | Direct `nodemailer@9.1.1` was vulnerable to address-parser denial of service, malformed recipient handling, and cross-transport TLS/DNS cache issues. | Baseline `npm audit --audit-level=high` failed with one high vulnerability and five advisory records. | Upgrade the direct dependency to `^10.0.13`; refresh compatible mail parser and icon lockfile entries. | Fixed; final audit has zero vulnerabilities. |
| R02 | P1 | Failure semantics | Dashboard and webhook error handlers awaited persistent error logging before responding. When the store itself was locked or unavailable, the secondary logging failure could replace the primary failure and leave the request without a deterministic response. Authentication-failure logging had the same coupling. | Direct source inspection of all four HTTP servers; new locked-store regression covers the receiver path. | Add one shared request-error recorder with explicit best-effort semantics; return the primary error and mark `error_log: "unavailable"` when persistence fails. Authentication failures retain their 401 response. | Fixed; regression tested. |
| R03 | P2 | Developer/agent output | `shipcheck` always observed its own active `.intake.intake-lock` and also flagged tracked `config/` and `CONTRIBUTING.md` plus ignored `.DS_Store` as unexpected. | `npm run release:check` emitted four false-positive root entries. | Recognize tracked root entries and known local/ownership artifacts; ratchet with a test. | Fixed; root-files check is now `ok`. |

## Changes implemented

### Supply-chain remediation

`package.json` now requires Nodemailer 10.0.13 or newer within major 10. The lockfile resolves Nodemailer 10.0.13, Mailparser 3.9.33, and Tabler Icons 3.48.0. Nodemailer 10 requires Node 20 or newer, which is compatible with this repository's existing `>=20.19.0` runtime contract. No runtime API usage changed; IMAP/SMTP configuration and action contracts are unchanged.

### Deterministic HTTP failure handling

`src/request-errors.js` centralizes the narrow rule that failure to persist a secondary error event must not prevent the primary HTTP response. Dashboard, generic webhook, Slack, and issue-provider receivers use it for request errors; receivers also use it for blocked authentication attempts. A failed audit write is not hidden from an authenticated/error response: JSON includes `error_log: "unavailable"` while preserving the original status and message. The new regression holds the store lock, submits an authenticated webhook, and proves a bounded 409 response rather than a lost response.

### Shipcheck signal quality

The root-layout check now treats committed `config/` and `CONTRIBUTING.md` as required, ignores `.DS_Store`, and recognizes sibling Intake lock/recovery artifacts. Missing required files still fail, and genuinely unknown root entries still warn.

## Performance and efficiency

No runtime speedup is claimed. The changes are off the normal success path except for a small helper call on HTTP failures. The existing benchmark gate remained green. Representative warmed results after the changes were: log page 8–9 ms (budget 1,000 ms), summary 8 ms (budget 1,500 ms), item page 6–8 ms (budget 1,000 ms), action page 25–32 ms (budget 1,000 ms), learning page 25–30 ms (budget 1,000 ms), approval audit 44–48 ms (budget 1,500 ms), and repeated dedupe 18–25 ms (budget 1,000 ms). Filesystem bulk timings varied between runs as already documented; no causal before/after claim is made.

Supply-chain impact: npm's audited dependency count changed from 52 production / 54 total to 53 production / 55 total because refreshed packages deduplicated Nodemailer while changing transitive composition. Vulnerabilities changed from one high-severity package finding to zero. Tests increased from 102 to 103. Shipcheck false-positive root entries changed from four to zero.

No model prompt, tool schema, replay, or agent-context path changed. Existing prompts remain bounded to relevant item fields; no unsupported token-reduction claim is made. Command output stays concise except for requested JSON and standard package verification receipts.

## Security and compatibility

Reviewed current authentication/HMAC checks, replay window, constant-time token comparison, request-body bounds, AI URL/input/output/deadline bounds, filesystem IDs and traversal checks, attachment quarantine, backup validation/decompression bounds, store/action locking, secret references/redaction, external action gates, and dependency advisories. This pass fixed the only current registry vulnerability and hardened the error path around an unavailable audit store. The earlier sealed security artifacts remain starting-revision evidence, not a claim about a new plugin scan.

- Public JavaScript exports: additive `recordRequestError` and `requestErrorPayload`; existing exports retained.
- CLI commands, exit codes, record schemas, backup formats, configuration keys, environment variables, Strata/TotalRecall formats: unchanged.
- HTTP success behavior and authentication status codes: unchanged. Error JSON can now add `error_log: "unavailable"` only when the error event could not be persisted.
- Runtime floor: unchanged at Node 20.19.0 or newer.
- External consumers: no migration required. Consumers that strictly reject additive error fields should allow the new diagnostic field.

## Remaining work

- **P0/P1:** No validated unresolved repository defect from this pass.
- **P2 / external evidence:** Live Slack validation still requires a configured test app and secret reference. Production outage, reverse-proxy, and load certification remain deployment-specific. Shipcheck intentionally continues to report external enterprise-readiness blockers.
- **Needs more evidence:** A fresh plugin-managed Deep Security Scan requires a host session with the managed filesystem permission profile expected by the Codex Security plugin. Existing manual and regression evidence does not substitute for that plugin result.
- **Not worth changing:** Cosmetic dashboard splitting, speculative caching, dependency replacement, and token trimming without measured value.
- **Cross-repository:** No required Kujo sibling change was found.

## Verification receipt

| Command | Result |
|---|---|
| `npm test` (baseline) | PASS: 102 tests. |
| `npm run verify` (baseline) | Lint, tests, smoke, 21 evals, and benchmark gate passed; npm audit failed with one high vulnerability. |
| `node --experimental-test-coverage --test tests/*.test.js` | PASS: 102 tests; 85.75% lines, 73.11% branches, 85.35% functions. |
| `node --test tests/email.test.js tests/resource-limits.test.js` | PASS: 7 tests after dependency refresh. |
| `node --test tests/webhook.test.js tests/slack.test.js tests/issues.test.js tests/dashboard.test.js` | PASS after the corrected contention fixture; 25 tests. |
| `node --test tests/shipcheck.test.js` | PASS: 3 tests. |
| `npm run verify` | PASS: lint, 103 tests, smoke, 21 evals, all performance thresholds, zero vulnerabilities. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | PASS: 103 tests on the minimum supported runtime. |
| `npx playwright install chromium && npm run test:browser` | PASS: Chromium token rotation, old-token revocation, authenticated save, reload, URL scrub, and no page errors. |
| `npm run release:check` | PASS: verify, shipcheck, doctor, and package dry run. External enterprise-readiness blockers remain explicit. |
| `git diff --check` | PASS. |


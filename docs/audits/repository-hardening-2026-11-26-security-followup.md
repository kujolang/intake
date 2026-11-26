# Intake security hardening follow-up · 2026-11-26

## Repository and scope

Intake is a local-first inbox and action-review CLI and dashboard. This pass started on clean `main` at `7c9c19b01854ee3386dd0e0567f370b183624eba`. The verified implementation is `08da365bbbfaa9d41292e748a3d1a760b4c9095c`. The security scope covered local storage and exports, loopback HTTP, webhook authentication, AI classification and action policy, outbound mail and GitHub adapters, npm dependencies, and CI. The [previous pass](repository-hardening-2026-11-26-security.md) covers action edits, dashboard token rotation, CSV exports, and restore permissions.

## Findings and changes

| ID | Priority | Area | Finding and evidence | Action and status |
| --- | --- | --- | --- | --- |
| SEC-5 | P0 | Action review | `classifyItemAndSave` overwrote a prior review requirement with the current pattern scan. `mergeAiResult` ignored an explicit negative automation recommendation. | Carry forward the stored review flag and require review if AI vetoes automation. Regression tests cover the stored flag through an action run, explicit approval, and a mocked negative AI recommendation. Fixed in `af189e9`. |
| SEC-6 | P0 | Signed ingress | Slack and GitHub handlers decoded the request before signature verification, so the signature covered the decoded representation. | Authenticate bounded raw bytes, then decode valid UTF-8 JSON. Tests cover signed Unicode and rejection of malformed encoding. Fixed in `130811b`. |
| SEC-7 | P0 | GitHub writeback | `addGitHubIssueComment` used the default fetch redirect behavior for an authenticated POST. | Refuse redirects, cancel the response body, and keep the existing uncertain-action handling. A mocked response verifies the request option and body disposal. Fixed in `130811b`. |
| SEC-8 | P0 | Memory exports | `src/exports.js` used umask-derived file modes and interpolated dynamic fields as Markdown. It also used unvalidated dates in default output paths. | Atomically write both exports with mode `0600`, validate the calendar date, and escape/flatten dynamic Markdown evidence. Tests verify output, replacement permissions, invalid dates and JSON fidelity. Fixed in `0476354`. |
| SEC-9 | P0 | Runtime and CI | The advertised Node.js floor, development pin and CI matrix predated the November HTTP/TLS security releases. Intake uses Node HTTP(S) servers and TLS clients. | Raise the floors and CI pins to 22.23.5, 24.22.3 and 26.13.1. Shipcheck checks all three pins. Fixed in `08da365`. [Node.js security release](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/). |

## Compatibility

Persisted store formats, wire signature formats, JSON export schema, configuration keys, and environment variables are compatible. The CLI still accepts an explicit export output path. Its `--date` flag now requires a real `YYYY-MM-DD` date. Strata Markdown represents dynamic punctuation with character references and flattens line breaks in evidence. GitHub comment operators must confirm the destination after a repository move and reconcile the original action before retrying. Existing Node installations below the declared minimum need an upgrade. Existing integrations require no cross-repository changes.

## Checklist coverage

| Phases | Evidence and scope |
| --- | --- |
| 0–2 | Reviewed the target, baseline, package, CI and prior audit. Traced the affected entry points through `workflow.js`, the issue and Slack receivers, and both exports. Extended existing locks, policy evaluation and bounded reads. |
| 3–4 | Checked byte limits, lock ownership, response cancellation and release resource gates. The webhook change authenticates the same bounded body used for parsing. |
| 5–6 | Reviewed the selected AI classification input, structured output and bounded response, plus evidence exported to memory tools. Classification registers no external tools. Receiver retries reuse stored receipts. Strata evidence stays inline in the existing report sections. |
| 7–9 | Checked auth order, UTF-8 and redirects, persisted review gates, action uncertainty, private output, storage confinement and journal recovery. Export writes retain atomic replacement. |
| 10–11 | Checked caller contracts, POSIX file mode and Node requirements, npm lock and install path, GitHub/Slack wire compatibility and scoped CI credentials. Runtime npm dependency versions are unchanged. |
| 12–14 | Extended the existing Node test suite and shipcheck. Updated operator and runtime documentation. |
| 15–16 | Checked scoped test entry points and operator recovery instructions. General refactoring, removal of dependencies and unrelated agent-output tuning were outside the security scope. |
| 17–18 | Implemented the fixes and ran fixture-based verification. |

No runtime, memory, or token-efficiency improvement is claimed. The release suite's existing latency and heap gates check for regression.

## Verification

- Baseline at `7c9c19b` on macOS and Node.js 26.12.1. `npm ci --ignore-scripts --prefer-offline` succeeded on a separate volume after the primary disk ran out of space. `npm run release:check` passed lint and docs links, then passed 248 of 249 tests. The bounded-reader subprocess reached its existing 30-second timeout under local contention, so the later baseline gates did not run.
- On macOS, `node --test tests/{hardening,issues,slack,final-audit,shipcheck}.test.js` passed 47 tests on Node.js 22.23.5. The same selection with `--test-concurrency=2` passed 47 tests on Node.js 24.22.3. Node.js 26.13.1 passed `node bin/intake.js shipcheck`, `node bin/intake.js doctor --json`, and `node scripts/check-package.mjs`.
- GitHub Actions ran `npm ci --ignore-scripts` and the complete `npm run release:check` on Node.js 22.23.5, 24.22.3 and 26.13.1. All passed. The browser job passed `npm run test:browser`, `npm run test:browser:sources`, and `npm run test:browser:design`. [Verification run](https://github.com/kujolang/intake/actions/runs/45906559437).
- The repository artifact guard passed for the same code revision. [Artifact guard run](https://github.com/kujolang/intake/actions/runs/45906559345).

## Remaining scope

No confirmed unresolved repository finding or required cross-repository change. Provider authorization, live mail delivery and hosted deployment behavior were outside fixture verification.

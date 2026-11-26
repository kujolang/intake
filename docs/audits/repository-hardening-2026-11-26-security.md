# Intake security hardening · 2026-11-26

## Repository and scope

Intake is a local-first inbox and action review workflow. The security pass started from a clean checkout on `main` at `be72a96bf2a752162af076908ca7c7785ccd6b49` after fast-forwarding to the recorded upstream baseline. The implementation ends at `a4c325677e1a70887da99ebed7850b621b4d433d`. Trust boundaries include loopback receiver and dashboard HTTP, local JSON and archive storage, AI classification, IMAP/SMTP and GitHub adapters, and Strata/TotalRecall exports.

## Baseline

On macOS with Node 26.12.1, the baseline passed `npm run release:check` in a temporary checkout with the locked dependencies, including 244 tests. The first dependency install hit local disk exhaustion. A clean retry with `npm ci --ignore-scripts --prefer-offline` succeeded, and the baseline release check ran after that retry.

## Findings

Confirmed by source review and covered by focused regression tests.

| ID | Priority | Area | Finding | Evidence | Action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-1 | P0 | Action lifecycle | Review could be skipped by assigning an approval status directly or by running an edited action under an automatic policy. Rejection could also hide uncertainty in an outbound attempt. | `src/dashboard.js` action creation and editing, `src/workflow.js` approval, rejection and run | Separate content edits from status transitions, require decision evidence, preserve review across retries and keep uncertain attempts visible. | Fixed |
| SEC-2 | P0 | Dashboard auth | A request authenticated before parsing could still reach routing after a token rotation. | Dashboard request handler and token rotation under the store lock | Recheck credentials under the lock before routing. | Fixed |
| SEC-3 | P0 | Storage | Store roots and restored file modes depended on the process umask. Restoring a private archive could expose data to other local users. | `initStoreLocked`, `saveSourcesLocked`, config import and restore staging | Create new and restored roots with 0700. Restore archived files and replace saved/imported source configurations with 0600. | Fixed |
| SEC-4 | P0 | Approval export | CSV quoting alone left formula-like field values interpretable as spreadsheet expressions. | Dashboard `csvCell` and approval audit output | Mark formula-like values as text in CSV. Preserve original JSON fields. | Fixed |

## Implementation and compatibility

- `ff914989cf829388d7cb6a62d5d8b3102ccacbe0` hardens action review, dashboard authorization, and audit formatting. The dashboard returns HTTP 400 for unsupported create or edit status transitions. A failed run preserves `needs_review` for actions requiring explicit approval, including legacy records with incomplete approval evidence. An operator can explicitly approve those records without rewriting the data. Rejection of an uncertain action returns HTTP 409 and leaves reconciliation evidence intact. A revoked in-flight token receives HTTP 401. Dashboard tests cover rotation, action transitions and CSV formatting. Workflow tests cover repeated runs after edits, existing records, legitimate approval, action concurrency and adapter failures with a mock.
- `a4c325677e1a70887da99ebed7850b621b4d433d` secures local store and restore permissions on POSIX. Tests inspect modes with a permissive umask and check config import recovery. Existing store root permissions remain operator-managed. A forced restore installs the private root, so operators who deliberately share a store must review its permissions before sharing the restored directory.
- Archive structure, configuration schema, environment variables, token transport, and protected route paths are compatible. CSV consumers that require exact raw field text can read JSON rows from the existing endpoint. Review and reconciliation semantics are documented in `docs/policy-engine.md`.

## Checklist coverage

| Phases | Evidence or scope |
| --- | --- |
| 0–2 | Checked Git state, test entry points, previous hardening, package scripts, CI and storage, dashboard, workflow and adapter contracts. Kept the existing store lock, dedicated approval command and CSV writer. |
| 3–4 | Reviewed bounded request, provider, attachment and restore reads and existing performance gates. No buffering or capacity changes were needed for these fixes. |
| 5–6 | AI receives selected classification fields under request and response limits. It has no tool registration or external action capability. Durable local records and paginated logs hold detailed evidence. No prompt, token-budget, replay or output changes were warranted. |
| 7–9 | Checked auth before parsing and inside the serialized route, lock-protected lifecycle transitions, stable rejection of uncertain attempts, backup validation and staging, raw-file confinement, webhook auth, provider transport, secret redaction, and escaped dashboard rendering. |
| 10–11 | Checked persisted state and return behavior. The install and audit used the existing lockfile, and CI uses pinned actions and an install without lifecycle scripts. |
| 12–14 | Added targeted regression coverage through existing Node test entry points. Kept package, dependency, performance and browser gates. Updated policy, dashboard, storage and recovery docs. |
| 15–16 | Reviewed selective test entry points and operator recovery guidance. Dependency removal, wholesale cleanup and new developer workflows were outside the security scope. |
| 17–18 | Implemented scoped fixes and verified the affected paths using fixtures, the local release gate and browser checks. |

No dependency changes or performance improvement are claimed. The built-in latency and heap gates provide regression checks for this pass.

## Verification

- `npm ci --ignore-scripts --prefer-offline` passed on retry.
- `npm run release:check` passed on baseline and implementation with Node 26.12.1. The implementation passed 249 tests, smoke, 21 evaluation scenarios, latency and bounded-heap gates, npm audit with zero vulnerabilities, shipcheck, doctor, and tracked-only package validation.
- `node --test tests/{core,hardening,dashboard,backup,config-import,mail-editor,campaign-mail}.test.js` passed 86 focused tests.
- Installed Chrome passed the operator, source filter, responsive layout and mail editor runs. The mail test uses mocked SMTP.

```sh
node --input-type=module -e 'import { chromium } from "@playwright/test"; const launch = chromium.launch.bind(chromium); chromium.launch = (options) => launch({ ...options, channel: "chrome" }); for (const script of ["browser-test", "browser-source-filter-test", "browser-design-test", "browser-mail-test"]) await import("./scripts/" + script + ".mjs");'
```

## Remaining work and cross-repository follow-ups

No unresolved in-scope findings or cross-repository changes. Live providers and a hosted deployment were outside the verification scope.

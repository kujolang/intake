# Intake repository hardening audit

Date: 2026-09-26. Repository: `kujolang/intake`. Branch: `main`.
Starting SHA: `e2140681bfef3ed02f1d09812c13c6ecd908d2df`.
Ending implementation SHA: `4f1e60d337a87e581b7743f4a8473b372499a20f`.
The subsequent documentation-only commit contains this report and evidence; its SHA is available with `git log -1 --format=%H -- docs/audits/repository-hardening.md`. A document cannot embed the SHA of its own containing commit.

## Repository and scope

Intake is a local-first, ESM Node CLI and authenticated dashboard for business-message ingestion, classification, approval, actions and memory exports. There is no build/transpilation step, TypeScript check, separate formatter or MCP server. Source adapters cover files, email, generic webhooks, Slack and issue systems. SMTP/IMAP and GitHub comments are external side effects; optional OpenAI-compatible classification sends message content to an operator-configured provider. JSON records, compact indexes and JSONL logs live under `--dir`, `INTAKE_DIR`, or `.intake`. Strata Markdown and TotalRecall JSON are file-based downstream contracts.

Reviewed all runtime modules and entry points, configuration/models, adapter contracts, tests/evaluations, fixtures/demo, benchmarks, documentation, package/lockfile, both CI workflows and release checks. Independent source security and architecture reviews are preserved in [security-review.json](artifacts/security-review.json) and [threat-model.json](artifacts/threat-model.json). These are immutable baseline observations, not a list of currently unfixed vulnerabilities. The generated [security report](artifacts/security/report.md) similarly describes the starting revision; finding extensions record remediation. Dependency source itself, live business data and credentials were excluded. No sibling repository implementation was changed.

## Baseline

`npm ci` succeeded. `npm run verify` passed syntax lint, **66 tests**, CLI smoke, **21 evaluations**, and the benchmark gate, then failed `npm audit --audit-level=high`: **seven dependency advisories (six high, one moderate)**. Logs are retained locally under `artifacts/` as ignored `.log` files. Machine-readable baseline audit and benchmark JSON are committed.

The initial benchmark used 500 manual items, 1,000 audit events, 250 file rows, 500 actions and 500 learnings. An additional representative log-page workload used 100,000 events / 21,788,890 bytes, fetching the newest 200 rows. Eleven selected new regression tests were then run against an isolated copy of the starting revision: **0 passed, 11 failed**. The baseline copy used the refreshed dependency installation, isolating source defects from dependency advisories, and was removed afterward.

## Findings

| ID | Priority | Area | Finding and evidence | Action | Status |
|---|---|---|---|---|---|
| H01 | P0 | Policy | `evaluatePolicy` calculated review separately from automatic eligibility; confidence and rule vetoes were ignored. `runAction` could run rejected actions. | Enforce all review gates, confidence, vetoes and terminal rejection; persist review independently of workflow status. | Fixed; regression and lifecycle tests |
| H02 | P1 | Policy scope/rules | No-match policies fell back to the first policy; proposed rules executed immediately. | Deny unmatched/empty policies; activate only approved or legacy statusless rules. | Fixed |
| H03 | P0 | Execution | Concurrent approved runs could duplicate sends/comments and overrun budgets; retries after ambiguous failures were unguarded. | Filesystem action lock, per-process queue, persistent executing/uncertain states, pre-execution budget reservation; edited payload loses approval. | Fixed for action execution; general transactions remain H15 |
| H04 | P1 | Persistence | Millisecond temporary names collided; concurrent index read/modify/write lost rows; action/learning IDs could collide in one millisecond. | Exclusive UUID temporary files, one atomic write implementation, collection queues, random action/learning seeds. | Fixed; concurrent-save and 1,000-ID tests |
| H05 | P1 | Backup | Two independent archive reads, incomplete validation, destructive replacement before extraction, unbounded decompression, non-atomic archive output. | One bounded verified snapshot, strict entry checks, staged restore and recovery rename, atomic compressed output without plaintext temporary archives. | Fixed; malformed/oversize/round-trip tests |
| H06 | P1 | Credential boundaries | Slack signing secret escaped sanitization; default backups copied inline credentials. | Mask signing secret in source output and omit all three supported inline secret fields from default backups. | Fixed; explicit secret inclusion preserved |
| H07 | P1 | URL/filesystem | Insecure-localhost prefix accepted external hostnames; file drops followed symlinks. | Structured URL parsing with exact loopback names; regular-file checks and no-follow opens. | Fixed |
| H08 | P1 | Supply chain | Baseline registry audit reported seven advisories. | Refresh lockfile within declared direct dependency ranges. | Zero advisories after clean install |
| H09 | P1 | Log resources | A 200-row page parsed and retained an entire unbounded log. | Reverse 64 KiB chunk reader, stopping after offset/page; keep all records on disk. | Fixed; Unicode, malformed-line, long-line and pagination tests |
| H10 | P2 | Sync efficiency | Each normalized item reread itself and both config files. | Internal classification helper receives existing item plus batch rules/settings snapshot. | Fixed; existing AI/dedupe/safety tests pass |
| H11 | P1 | Failure contracts | JSON doctor/backup verification returned success exits on failed checks; bind failures could become uncaught server errors; unreadable collections looked empty. | Preserve failure exit codes, reject startup promises, propagate non-ENOENT collection/retention errors. | Fixed |
| H12 | P2 | Resources/config | IMAP acquisition failure could leave a connection; runtime sync skipped the explicit secure-config gate; absolute dotenv path was joined incorrectly. | Guard IMAP setup, close failed connections, release mailbox in finally, resolve absolute state paths correctly. | Fixed |
| H13 | P2 | Dashboard | Rotation kept the old token captured by API calls and put the new token back into history; icons depended on cwd; health always said local-only. | Mutable in-memory token, clean history path, module-relative icons and actual health posture; serialize mutations and use prototype-free counters. | Source/API checks pass; browser execution unavailable |
| H14 | P2 | Runtime contract | Package advertised Node 18 although baseline `html-to-text@10.0.0` required Node >=20.19. | Align manifest/docs; CI covers 20.19.0, 22, 24. | Minimum runtime locally verified |
| H15 | P1 | General state | Config/source snapshots, multi-process record/index mutations and retention-vs-append lack a shared transaction. | Document one writer and quiescent maintenance; preserve follow-up in SignalBox. | Open architecture work |

## Changes implemented and compatibility

### Action safety and deterministic classification

Files: `src/policy.js`, `src/rules.js`, `src/workflow.js`, `src/action-lock.js`, `src/dashboard.js`, `tests/hardening.test.js`.

The root cause was independent calculations of permission, risk, review and automatic execution. Automatic execution now requires every gate, including confidence. Matching approved rules contribute action vetoes; explicit human approval cannot override those vetoes. Safety/AI review remains in `item.policy.requires_human_review` after drafting changes the item status. Legacy rules without status remain compatible. A batch uses a consistent rules/settings snapshot; manual classification still loads current settings.

Action locking includes all action IDs in a store because rate budgets are shared. Existing locks fail with an actionable conflict instead of sleeping or being stolen. Budget reservations occur before external effects; uncertain attempts consume budget conservatively. `executing` and `execution_uncertain` require reconciliation and explicit approval before retry. This is not an exactly-once delivery guarantee across providers. Editing body/type clears approval; rejected actions remain terminal. Network outcome ambiguity and crashed locks are explicit rather than silently retried.

### Durable records, backup and input boundaries

Files: `src/util.js`, `src/storage.js`, `src/models.js`, `src/backup.js`, `src/source-config.js`, `src/adapters/file.js`, `src/ai.js`, `src/secrets.js`, `src/adapters/email.js`, `src/retention.js`, `tests/hardening.test.js`.

Atomic writes use unpredictable, exclusive temporary names and share one implementation. Per-collection queues cover record write plus index update and rebuild, and idle queues are removed. IDs retain their existing prefixes/shape while distinct actions/learnings no longer depend solely on clock resolution. These queues are process-local, not a general database transaction.

Backup format/version and checksums are preserved. Verification handles malformed root/entry types, invalid paths/base64, duplicates and file/parent conflicts. The exact decoded archive is validated once and staged; staging failures preserve the target. Compressed output is atomically renamed and initially private (`0600`). The 256 MiB decompressed ceiling has an explicit `--max-bytes` escape for larger trusted archives. Supported colon-bearing record IDs still round-trip. Power loss during the final rename sequence can require recovery from the sibling previous/staging directory; do not run maintenance concurrently with writers.

Default backup removal of inline credentials is an intentional security correction. Environment/Keychain references remain; operators using legacy inline secrets must re-provision them or explicitly request secret-bearing backups. File-drop symlinks are now skipped. AI base URL validation honors HTTPS and the existing explicit loopback HTTP opt-in, including IPv6 loopback. Configuration is still operator-controlled; this is not an SSRF sandbox.

### Read efficiency, failure semantics and developer verification

Files: `src/logs.js`, `src/dashboard.js`, `src/cli.js`, adapter startup functions, benchmark scripts, package/CI, README and affected documentation.

The log reader seeks backward and decodes complete lines, avoiding corruption across UTF-8 chunk boundaries. It retains malformed-line diagnostics and closes handles on failure. Pagination controls output volume without truncating stored evidence. Dashboard and adapter bind failures reject their startup promise. Missing files retain their existing empty/fallback behavior; actual filesystem failures propagate. JSON diagnostic modes now set failure exit codes consistently.

The dashboard token rotation fix is covered by existing API tests and source review; no connected browser was available (`cua.listBrowsers()` returned `[]`), so no browser interaction is claimed. No new runtime dependency was added. Node runtime metadata was corrected to the dependency floor already present in the original lockfile.

## Performance and efficiency

Host: macOS, installed Node `v26.7.0`; minimum-runtime tests also use Node `v20.19.0`. Values are wall-clock samples, not production promises.

| Dimension | Before | After | Evidence/interpretation |
|---|---:|---:|---|
| Newest 200 audit rows from 100,000 events, median of 5 warmed requests | 201.53 ms | 8.03 ms | `baseline-log-bench.json`, `after-log-bench.json`; exact same 200 IDs |
| Compact JSON representation of that response | 43,610 bytes | 43,610 bytes | No records or fields removed |
| Log bytes needed for this page | 21,788,890 | 65,536 | File size measured; after read bound derived from one chunk and row lengths, not OS I/O telemetry |
| Per-item classification reads during 125-new-item sync | 375 item/config reads | 2 batch config reads | Code-derived count; no model-token claim |
| Registry advisories | 7 (6 high, 1 moderate) | 0 | Baseline audit JSON and clean final audit |
| Installed packages audited | 48 | 52 | Security updates added transitive packages; no dependency-size reduction claimed |
| Tests | 66 | 91 | 25 new regression tests |

The three interleaved full benchmark runs are preserved in `controlled-{baseline,after}-bench-{1,2,3}.json` and summarized in `performance-comparison.json`. They used the same refreshed dependency tree. Medians: sync 2,833→2,518 ms; repeated dedupe 51→38 ms; warm item page 9→9 ms; summary 12→14 ms; action page 100→65 ms; learning page 127→68 ms; approval audit 129→145 ms. Bulk insert timings were mixed (items 2,298→4,276 ms; actions 1,511→2,036 ms; learnings 1,514→1,466 ms), so these samples do **not** establish a repository-wide speedup.

A follow-up alternating atomic-write microbenchmark isolates the primitive: 200 writes/run, six runs each; old median 538 ms, hardened median 493.5 ms (`atomic-write-bench.json`). This does not reproduce the bulk-insert slowdown, and indicates substantial filesystem/run variability. Existing latency gates pass unchanged apart from the additional 1,000 ms log-page gate. No memory/RSS, CPU, binary size, build-time or model-token improvements are claimed. Reverse paging provides a code-supported allocation bound proportional to the page/chunk plus longest requested line; explicit unbounded limits still request all records.

AI prompts already provide one system instruction plus the relevant item fields, without conversation replay or tool-schema duplication. The body is intentionally retained for correctness. There is no MCP schema or eager agent instruction registry to compact. Export formats and normal CLI output remain intact. Detailed evidence remains in files, with concise command receipts.

## Security review and remaining concerns

Reviewed inbound authentication/HMAC, dashboard shared-token authority/TLS/CSP, rule and AI trust separation, action approval/side effects, secrets and exports, path validation/quarantine, archive handling, provider destinations, process invocation, dependency integrity and concurrency. Nine baseline source findings were remediated, with new behavioral tests. The generated security artifacts preserve baseline evidence and calibrated deployment prerequisites; defaults already limited exposure.

The local operator owns state/configuration; dashboard token holders have the same administrative authority. File permissions, reverse proxies, live credential scopes and downstream memory review remain deployment responsibilities. Quarantine is not malware scanning. Secret-excluding backups still contain business records and raw message content and must be protected.

No unsupported dependency replacement, safety bypass, suppressed test, weakened assertion, arbitrary sleep, speculative cache or unrelated style rewrite was introduced. Existing timeout-based smoke lifecycle remains unchanged.

## Public contract receipt

- APIs: existing exported functions retained; `verifyBackup` additionally accepts optional `maxBytes`. New internal helpers are additive.
- CLI: command names unchanged; failed `doctor --json` and `backup verify --json` now exit 1; backup verify/restore support `--max-bytes`.
- File formats/schema: JSON record and backup versions unchanged; additive `policy.blocked_actions`, `policy.requires_human_review`; action status consumers must display `executing`/`execution_uncertain` and honor reconciliation. No hardcoded consumer in this repository rejects those statuses.
- Config/environment: names retained; Node engine floor corrected; policy flags now enforce their documented intent. Absolute `INTAKE_DIR` dotenv loading corrected; `--dir` still does not select dotenv loading (existing startup contract).
- IDs: prefix/shape retained; newly generated action/learning IDs are unique rather than repeatable within a millisecond.
- Backups: default inline-secret removal, decompression limit and staging behavior are documented migration considerations; explicit secret inclusion and larger archive bounds remain available.
- External consumers: no sibling implementation change is required. Custom consumers that enumerate action statuses must accept the two new recovery states. Strata/TotalRecall file formats are unchanged.

## Remaining work and cross-repository follow-ups

- **P0:** No remaining validated P0 issue in the completed supported single-writer pass.
- **P1:** H15 needs a store-wide transaction/recovery design before supporting multiple writers or concurrent maintenance. Batch sync failure/retry and snapshot consistency belong in that work; one-writer/quiescent-operation guidance is the current boundary.
- **P2:** Run browser token-rotation interactions when a browser is connected; capture live PrivateEmail/Slack/provider behavior before asserting enterprise deployment readiness. Remote CI passed for the audited code/documentation commit, as recorded below. Shipcheck still lists external gates because it does not query remote evidence. Large mail/file/AI response workloads and provider cancellation/timeouts need representative limits and additional failure fixtures before broad resource guarantees.
- **Needs more evidence:** Bulk filesystem benchmark variance; production retry/outage characteristics; real proxy exposure. No speculative optimization or enterprise-readiness claim.
- **Not worth changing/P3:** Dashboard HTML/module split, cosmetic style rewrites, wholesale CLI redesign, dependency replacement, hand-trimmed AI message bodies. Existing format and explicit behavior carry more value.
- **Cross-repository:** No required sibling code change. Strata and TotalRecall integrations remain file-compatible. Provider live verification remains an external evidence requirement, not a hidden ecosystem migration.

SignalBox: Capture `cap_af2f3cfa-ba93-40b5-bfa7-7afc1b7026fc`, Signal `sig_78602483-19b1-4717-b0da-5847312962fa` preserve H15. Both exact-ID and concept retrieval passed; no duplicates found. Completed fixes, routine verification and speculative/privileged-only observations were rejected from SignalBox.

## Verification receipt

All commands below ran from this repository unless otherwise noted. No live outbound message was sent. Test/demo state used temporary directories.

| Command | Result |
|---|---|
| `npm ci` (baseline) | Pass; 7 advisories recorded |
| `npm run verify` (baseline) | Lint, 66 tests, smoke, 21 evals and benchmark pass; audit fails |
| `npm audit --json` | Baseline findings preserved in `baseline-audit.json` |
| `node scripts/bench.mjs --items 500 --logs 1000 --fileRows 250 --actions 500 --learnings 500` | Initial before/after and 3 interleaved source comparisons captured |
| `node scripts/bench-logs.mjs` | Before/after output-equivalent log workload passes |
| `npm audit fix` (twice, within existing ranges) | Final clean installation has zero advisories |
| `node --test --test-name-pattern='automatic execution\|empty and nonmatching\|proposed rules\|AI localhost\|atomic writes\|concurrent item\|default backup\|malformed archives\|file sources\|absolute INTAKE\|backup verification JSON' tests/hardening.test.js` against isolated starting revision | 11/11 fail, confirming baseline defects |
| `node --test tests/hardening.test.js` | Initial 19 regressions pass; subsequent additions included in full suite |
| `npm ci` then `npm run verify` | Pass: lint, 91 tests, smoke, 21 evals, all benchmark thresholds, zero advisories |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | Minimum supported runtime suite passes |
| `node bin/intake.js init --dir TEMP_DIR`; `INTAKE_DIR=TEMP_DIR npm run release:check` | Pass; isolated full release validation; receipt in `artifacts/release-check.log` |
| `git diff --check` | Pass |
| Security skill capability preflight and canonical report finalization | Pass; generated report and sealed JSON under `artifacts/security/` |

The local ignored `.log` files retain verbose output. Machine-readable evidence, log digests in `artifacts/verification.json`, and this report are committed. There is no separate build/type/format task to invent. Live-source checks are not represented as completed. Remote `verify` and `kujo-tool-artifacts-guard` both completed successfully for `7f3bd6b1ad456abb030accb7b8273ec42932ae51`: [verify run](https://github.com/kujolang/intake/actions/runs/36220868407), [artifact guard run](https://github.com/kujolang/intake/actions/runs/36220868408). `artifacts/remote-ci.json` preserves the exact head and conclusions. The following documentation-only receipt commit does not change the verified implementation.

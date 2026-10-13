# Intake repository hardening — 2026-10-12

- Repository: `kujolang/intake`; branch: `main`.
- Starting SHA: `6f64126bdaa9a33b82f2b0d2dfdb8726828d0b00` (clean working tree).
- Ending implementation SHA: `33a0bf63d3c97077b1da677a39cbf1adb4be6bd7`.
- Implementation commits: `4d5a8c7` (maintenance), `ec26233` (AI), `33a0bf6` (attachments).
- The later evidence-only commit contains this report. Its SHA is obtainable with `git log -1 --format=%H -- docs/audits/repository-hardening-2026-10-12.md`; a report cannot embed the SHA of its own containing commit.

## Scope and ground truth

Intake is a local-first ESM Node CLI and authenticated dashboard for ingestion, deterministic/optional AI classification, approval, outbound actions, and learning exports. Source adapters cover manual/file/email/webhook/Slack/issue inputs; IMAP/SMTP and GitHub comments are external-effect boundaries. JSON documents, compact indexes and JSONL audit logs live under the selected store. Strata Markdown and TotalRecall JSON are file interfaces, not direct memory writes. No sibling repository was modified and no live provider message was sent.

Inspected runtime entry points and modules, ingestion limits and cursors, models/defaults, rules/policy, store/action locking and recovery, source history, archive/retention/export paths, dashboard HTTP and DOM rendering, configuration/secrets, regression tests, fixtures/demo/evals, benchmarks, documentation and earlier audits, package metadata/lockfile, and both CI workflows. Dependencies remain ImapFlow, Mailparser, Nodemailer and Tabler icons, with Playwright for browser checks. The package remains private. There is no build/transpilation, standalone formatter, type checker, model/tool schema registry, or MCP server to run or simplify.

Contracts reviewed: CLI commands/flags and failure exit codes; `INTAKE_DIR`/`--dir` and environment/Keychain secret references; storage and backup schemas; authenticated HTTP JSON responses; adapter sync/action return shapes; action approval/reconciliation states; source/record IDs; configuration exports and Strata/TotalRecall output. Supported record IDs, field names, transport defaults, command names and export schemas remain intact.

## Baseline and reproductions

Host: macOS, Node `v26.7.0`; minimum-runtime checks also use `v20.19.0`.

`npm ci` and the original `npm run verify` passed: syntax lint, documentation links, **111 tests**, CLI smoke, **21 evaluations**, dashboard/dedupe benchmark gates, and **zero dependency advisories**. No pre-existing verification failure was observed. npm's local `python` configuration warning is an environment warning, not a repository defect.

Seven selected new regression tests were executed against the corresponding unmodified implementations before fixes: three maintenance tests, two AI/model tests, one attachment test, and one backup-option test. **All seven failed**, establishing the behavior rather than relying on stylistic inference. An isolated copy of baseline retention also exhausted the new fixture's 64 MiB V8 old-space budget; the corrected implementation passes that same workload.

Verbose logs remain local and ignored under `docs/audits/artifacts/2026-10-12/`. Small JSON measurements are versioned. `verification.json` records log hashes and final receipts.

## Implemented changes

| Problem / root cause | Implementation and affected files | Regression coverage | Compatibility / impact |
|---|---|---|---|
| Invalid log-retention settings were validated after raw files had already been deleted. | Validate both limits before either destructive phase in `src/retention.js`. | Invalid mixed request preserves its old raw payload. | Valid requests and receipt shape unchanged; invalid requests fail before deletion. |
| Purge deleted actions before validating linked payloads, and containment allowed any file inside the store. | Preflight every linked path, require a file beneath `raw/`, reject symlink components, then mutate. `src/retention.js`. | Traversal, config-file and raw-root targets preserve all records/payloads; symlinked directory leaves external file intact. | Intentionally refuses corrupt/unsafe stored paths; no supported adapter creates these paths. Existing missing raw payloads remain tolerated. |
| Retention buffered the entire log and all retained lines; epoch timestamps were mistaken for absent timestamps. | Stream UTF-8 lines with backpressure into an atomic temporary file; preserve mode, malformed/undated lines, no-op file bytes, and cleanup. Explicit null timestamp sentinel. `src/retention.js`, `scripts/bench-retention.mjs`, `package.json`. | Epoch expiration, CRLF/lone CR, multi-chunk Unicode, missing timestamp, preview parity, unchanged files, mode preservation, read failure cleanup; exact-output heap gate. | JSONL and receipt formats unchanged. Temp disk scales with retained data; memory scales with buffers and largest line. No blanket RSS cap. |
| Invalid backup rotation options were rejected only after replacing the output archive, or silently disabled rotation. | Validate supplied `keep` as a positive safe integer before initialization/archive output. `src/backup.js`. | Negative, zero, fractional and nonnumeric values preserve the existing output. | Valid integer/string-integer values and omitted rotation unchanged; invalid values fail earlier. |
| Syntactically valid AI JSON could be null, scalar, or have invalid field types, breaking later classification or persisting malformed state. Response-limit validation occurred after the request; HTTP failures retained unread bodies. | Validate known optional fields before merging, use existing review-required fallback, preflight limits, cancel unsuccessful response streams. `src/ai.js`. | Invalid roots/fields, valid partial results, zero confidence, invalid limit makes zero calls, failure body is cancelled. | Request prompt/fields unchanged; partial valid results remain accepted; malformed values no longer reach persistence. |
| Explicit zero confidence was changed to null by truthy fallback. | Use nullish fallback in `src/models.js`. | Zero survives item creation. | Corrects loss of a valid existing numeric value. |
| Attachment path checking was lexical and `stat`/`readFile` used separate path reads; growth could exceed the intended cap. | Check canonical containment, open with no-follow, inspect/read the same handle, reuse bounded streaming. `src/attachments.js`. | Symlink-parent escape rejected; exact byte limit accepted; excess/zero limit rejected; existing dashboard/quarantine tests retained. | Download response shape/default 25 MiB unchanged. Explicit cap must be a positive bounded integer. Local hostile filesystem races are not a supported sandbox boundary. |

Documentation updated: `docs/resource-limits.md`, `docs/attachment-policy.md`, `docs/restore-drill.md`. Ten behavioral tests were added, bringing the suite to **121**. Existing assertions and limits were not weakened. The heap/output gate is part of `verify`, so the existing Node 20.19/22/24 CI matrix inherits it without a separate fragile timing threshold.

## Measurements

Representative retention workload: 200,000 JSONL events, alternating expired/retained, **94,700,000 input bytes**. Fixture generation runs outside the measured worker. Peak RSS is Node `process.resourceUsage().maxRSS` sampled after compaction, before reading the result for hashing. Measurements below are single same-host samples, not production promises or a general speedup claim.

| Dimension | Before | After |
|---|---:|---:|
| Peak worker RSS, KiB | 461,572 | 66,076 |
| Compaction wall time, ms | 1,188 | 1,257 |
| Retained output bytes | 47,400,000 | 47,400,000 |
| Removed / retained records | 100,000 / 100,000 | 100,000 / 100,000 |
| Same workload with 64 MiB V8 old-space budget | Heap exhaustion | Pass on Node 26 and Node 20.19 |
| Unit/integration tests | 111 | 121 |
| Registry dependency advisories | 0 | 0 |
| Runtime / development dependency entries | 4 / 1 | 4 / 1 |

Before/after output SHA-256: `ce033959a79ba013fe88cbf1632c15fcaad7105722793490e9cedb61d8db4d31`. Evidence: `retention-before.json`, `retention-after.json`, `retention-heap-regression.json`, and `dependency-audit.json` in the dated artifacts directory. Timings do not establish a latency improvement; the demonstrated benefit is reduced memory with identical retained data. No dependency-size, binary/build-time or model-token improvement is claimed.

The baseline dashboard gate measured warm logs/summary/items/actions/learnings/approval-audit at 14/12/9/45/39/56 ms, and repeated dedupe at 48 ms. Final gates retain the same thresholds; results are in the release log. There was no supported reason to rewrite indexed reads, provider SDKs, or the CLI/dashboard structure.

## Boundaries and efficiency reviewed

- Authentication/signatures: webhook tokens, Slack HMAC/skew, issue HMAC/token handling; dashboard constant-time token checks, local binding/TLS requirements, rotation, URL scrubbing and DOM text rendering. No change to token-holder administrative authority.
- Actions/state: store lock spans sync/maintenance and preserves explicit recovery; outbound action lock, terminal states and uncertain-effect reconciliation remain. Tests continue covering concurrent writers, crashed owners, failed batch classification/cursor preservation, and deterministic denied actions.
- Files/archives: file-source no-follow bounded reads; backup checksums/base64/path/decompression/staging and secret exclusions; purge/quarantine changes above. Hostile same-user directory replacement, disk failure and power loss are outside transactional guarantees. No multi-file rollback claim.
- Provider/model trust: prompt content remains data, deterministic safety can only be strengthened by AI results, input/response limits and deadlines remain; new result validation rejects malformed shapes. Secrets remain outside normal config where configured; no credentials entered evidence.
- Resource/complexity: removed whole-log buffering without a cache, preserved structured diagnostics and atomic replacement, reused bounded readers. Directory/index/individual-record and backup buffering remain existing explicit scalability boundaries. No speculative broad rewrites or dependency replacements.
- Agent/context/output: one system instruction plus selected item fields; no conversation replay or duplicated tool schemas. Classification fields and body retained for correctness. No token savings claimed. Paginated log/item APIs and source history limits remain; verbose test output is preserved in ignored files and a compact verification receipt. The new benchmark prints only measurements/counts/hash, not 47.4 MB of retained records.

## Verification commands and results

Commands run from the repository unless specified. Temporary stores isolate release/demo state from the operator's `.intake`. The release invocation used Python `tempfile.TemporaryDirectory` with `INTAKE_DIR` set for the child process.

| Command | Result |
|---|---|
| `npm ci` | Pass; 55 packages installed, zero advisories. |
| `npm run verify` before implementation | Pass; 111 tests, smoke, 21 evals, existing performance gates, audit. |
| `node --test --test-name-pattern='validates every option\|validates all payload paths\|preserves malformed' tests/lifecycle.test.js` before fixes | 3 expected failures. |
| `node --test --test-name-pattern='invalid model shapes\|explicit zero' tests/ai.test.js` before fixes | 2 expected failures. |
| `node --test --test-name-pattern='downloads reject' tests/attachments.test.js` before fixes | 1 expected failure. |
| `node --test --test-name-pattern='validates keep' tests/backup.test.js` before fixes | 1 expected failure. |
| `node --test tests/attachments.test.js tests/lifecycle.test.js tests/ai.test.js tests/resource-limits.test.js` | Pass: 22 tests. |
| `node --test tests/backup.test.js tests/lifecycle.test.js` | Pass: 14 tests. |
| `node scripts/bench-retention.mjs` before and after | Pass; identical result checksum/counts. |
| `node scripts/bench-retention.mjs --bounded-heap` in isolated baseline-retention copy | Expected failure: confirmed heap exhaustion, core dumps disabled. |
| `npm run bench:retention` | Pass: exact retained-output hash under the heap budget. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | Pass: 121 tests. |
| `npm exec --yes --package=node@20.19.0 -- node scripts/bench-retention.mjs --bounded-heap` | Pass. |
| `npm audit --json` | Pass: zero advisories, unchanged lockfile. |
| `npm run test:browser` | Pass after installing matching Chromium with `npx playwright install chromium`; desktop/mobile ownership, snooze, command palette, token rotation, URL scrub, save/reload, no page errors. Initial missing-browser failure was environmental. |
| `INTAKE_DIR=<temporary store> npm run release:check` | Final pass: lint, links, 121 tests, smoke, 21 evals, latency/heap gates, audit, shipcheck, doctor, tracked-only packaging. Initial package gate correctly rejected a new unstaged evidence JSON; fixed by staging it, without bypassing the gate. |
| `git diff --check` | Pass. |

Final local proof is recorded in `verification.json` with hashes of the ignored logs. The package gate is rerun after staging this final receipt. Remote CI is checked after pushing; the exact head and run results are retained in the Strata handoff rather than making a self-referential documentation commit.

## Compatibility and remaining work

- Public APIs: names/signatures and supported result shapes unchanged; invalid model/maintenance/download inputs now fail safely or use the documented AI fallback.
- CLI: commands/flags/exit-code conventions unchanged; invalid `backup --keep` fails before archive replacement.
- Persisted formats/schemas: no version change. Zero confidence is preserved. Epoch-dated logs now expire correctly.
- Config/environment: no new key, environment variable, default capability or runtime dependency. Existing attachment cap override is validated consistently.
- External consumers: Strata/TotalRecall exports and provider request bodies unchanged. No sibling implementation or migration is required.
- P0/P1: no unresolved validated finding within the implemented scope; no known introduced regression.
- P2 / existing external evidence: live disposable mailbox delivery and Slack/issue writeback still require configured sources and explicit external-effect authorization. They are not prerequisites for these local fixes; no live verification is claimed here.
- Needs more evidence: deployment-specific proxy/shared-filesystem/power-loss behavior, adversarial local-directory races, representative workload scaling beyond the tested local store, and an ImapFlow major-version migration. These are existing scope limits, not certified guarantees.
- P3 / not worth changing: cosmetic module splits, framework/CLI rewrites, dependency replacement and lossy prompt trimming.
- SignalBox: no captures warranted. Newly reproduced findings were fixed; existing live-provider/deployment prerequisites are already documented, not new action items.

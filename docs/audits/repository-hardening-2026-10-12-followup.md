# Intake failure-path and resource-limit follow-up

## Scope and baseline

Repository: `kujolang/intake`, branch `main`. Starting SHA: `01e380db070a6c564b2608055365c69fecf1236d`. Ending implementation revision: `0f43961a7b253639c57e55cfce4fddb3527d9cf2` (the later evidence-only commit contains this report). This second pass follows [the first audit](repository-hardening-2026-10-12.md).

Intake is a local-first intake CLI/dashboard with JSON/index/JSONL persistence, optional AI classification, and file, email, webhook and issue adapters. Reviewed stream ownership, partial startup, provider cleanup, file ingestion/cursors, request limits, maintenance, backup, attachment access, and command failure reporting against implementation and existing tests. Relevant dependencies remain ImapFlow, Nodemailer, Mailparser and Playwright. No dependency additions or changes.

Before edits, `npm run verify` passed all 121 tests, lint, documentation links, smoke, eval, benchmark gates, retention heap gate and dependency audit. Seven new failure-path tests and two file-cursor tests failed against the starting implementation. The IPv6 regression was added during implementation and passed after the fix; no pre-fix execution claim is made for that test. Local detailed logs are in `artifacts/2026-10-12-followup/` and are intentionally ignored by Git; committed measurements and the verification receipt preserve portable evidence.

## Implemented changes

| Problem and cause | Change and regression evidence | Compatibility |
| --- | --- | --- |
| A byte cap retained one Buffer per fragment, allowing tiny/empty fragments to exhaust heap. Text chunks also bypassed byte accounting in the binary reader. | `resource-limits.js` coalesces into bounded slabs, checks UTF-8 bytes and ignores empty fragments. `util.js` shares that reader. A 48 MiB heap test processes one million bytes in two million fragments; iterator failure, reused buffers and HTTP 413 remain covered. | Payload and limit behavior retained; malformed text accounting corrected. No truncation. |
| IMAP logout failure masked append failure and left sockets open; readiness cleanup also leaked on logout rejection. | `adapters/email.js` force-closes on failed logout, preserves the primary append error, and prepares draft content before connecting. Mocked dual-failure and successful-append/failed-cleanup regressions verify behavior. | An append followed by failed logout still rejects, so existing uncertain-write handling is retained. |
| SMTP transport was acquired before recipient validation. | Validate before transport creation; regression asserts no acquisition for an invalid recipient. | Existing missing-recipient error retained. |
| Dashboard audit-log failure after listen left an inaccessible running server. IPv6 loopback generated malformed URLs. | `dashboard.js` closes listener/connections on startup failure and brackets IPv6 URL hosts. Tests exercise an audit path replaced by a directory and an authenticated real IPv6 HTTP request. | Public return shape unchanged; documented loopback support repaired. IPv6 test skips only when the OS lacks loopback support. |
| Failed source readiness returned process status zero. | `cli.js` sets status 1 while preserving structured diagnostics. Child-process regression verifies both. | Intentional CLI bug fix: automation can now detect failure. README updated. |
| Malformed files consumed read/parse work without reducing batch allowance. | `adapters/file.js` charges bytes before parsing; failed reads conservatively consume their read allowance. Two-file regression verifies deferral and resume. | Malformed inputs remain retryable, and no truncated item is created. |
| Bounded seen-cache eviction plus restarting sorted scans permanently starved later files. | Add a lexical resume bookmark at batch boundaries. A real 6,001-file regression starting with a legacy cursor proves eventual delivery while preserving 5,000 cached keys and 1,000 items per batch. | Additive opaque cursor field `next_file`; legacy cursors work without migration. Item IDs and ingestion deduplication remain unchanged. |

Implementation commits: `1872e48` and `0f43961`. Regression files: `tests/failure-paths.test.js` and `tests/file-cursor.test.js`. Operational limits: [resource limits](../resource-limits.md).

## Measured impact

`node scripts/bench-streams.mjs`, same host, Node v26.7.0, one sample per reader per revision. Fixture: 1,048,576 bytes, 2,097,152 fragments including empty fragments.

| Reader | Before time | After time | Before peak RSS (KiB) | After peak RSS (KiB) |
| --- | ---: | ---: | ---: | ---: |
| Bytes | 3,627 ms | 1,238 ms | 500,952 | 52,328 |
| Text | 1,860 ms | 1,372 ms | 380,080 | 54,816 |

Both outputs retained length and SHA-256 `8f990ba0b577b51cf009ea049368c16bbda1b21e1b93be07a824758bb253c39b`. These are fixture-specific samples, not general latency/RSS guarantees. See [before](artifacts/2026-10-12-followup/streams-before.json) and [after](artifacts/2026-10-12-followup/streams-after.json). The 48 MiB heap regression runs in the standard test suite. Full MIME parsing, directory enumeration, decoded data and persistent indexes still add memory beyond accepted payload bytes. No token, dependency-size or package-size reduction is claimed. Existing prompt/input caps and compact command output remain unchanged.

## Verification and boundaries

Exact commands and outcomes are recorded in [verification.json](artifacts/2026-10-12-followup/verification.json). The full release check uses an isolated temporary `INTAKE_DIR`. Checks cover lint, links, 131 tests, smoke, eval, normal performance and retention gates, dependency audit, shipcheck, doctor and package contents. Node 20 compatibility and Chromium are checked separately. No new dependencies, environment variables, configuration keys or externally required changes; public function signatures and HTTP shapes remain unchanged. Cursor metadata and the corrected CLI failure exit status are the only serialization/automation behavior changes.

Reviewed trust boundaries include untrusted stream chunks, local file inputs, remote provider cleanup, authenticated dashboard startup and existing destructive maintenance/attachment boundaries. New provider cleanup regressions use mocks and do not send messages. Local and CI checks do not prove delivery against live IMAP/SMTP accounts or every deployment filesystem. Existing local-store trust assumptions remain in force.

No newly discovered unresolved P0–P3 or cross-repository requirement remains from this pass. Needs more evidence: live provider/deployment behavior retains the existing integration boundary and was not expanded into production-account testing. Not worth changing: cosmetic module restructuring, dependency substitution and speculative caching without a reproduced defect. SignalBox captures are not warranted for resolved fixes or these unchanged verification boundaries.

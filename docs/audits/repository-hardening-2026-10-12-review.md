# Combined audit-change regression review

Repository: `kujolang/intake`, branch `main`. Reviewed combined changes from `6f64126bdaa9a33b82f2b0d2dfdb8726828d0b00` through `dcd586560f6fc51fc0602ec809efbde3b6037928`. Starting worktree was clean. Ending implementation: cb7ae7b04ee3d887b6e33306552c3e062fa7bade. This review follows the [first audit](repository-hardening-2026-10-12.md), [failure/resource pass](repository-hardening-2026-10-12-followup.md), and [persistence/recovery pass](repository-hardening-2026-10-12-recovery.md).

## Fixed findings

| Finding | Evidence and correction | Scope |
| --- | --- | --- |
| Attachment FIFO can hang while holding the store lock. | The containment fix moved the regular-file check after `open`, but a blocking FIFO open never reached that check. A real FIFO regression timed out before the fix. Add `O_NONBLOCK` while retaining `O_NOFOLLOW`, then reject non-regular descriptors and close them. Existing ordinary download/size/containment tests still pass. | Regression introduced by the attachment hardening change. No new API or limit. |
| Dangling aliases bypass canonical ownership during restore interruption. | After the target-to-previous rename, `realpath` fails and lock identity incorrectly falls back to the alias pathname. A chained relative alias returned default settings rather than refusing the stale writer. Resolve dangling root symlink targets recursively with cycle/depth protection; the alias now finds the original lock and journal and can recover original settings. | Gap in the new interrupted-restore/symlink contract. Existing aliases and returned paths remain compatible. |
| Raw retention follows a symlink at its traversal root. | Nested symlinks were skipped, but `readdir(rawRoot)` still followed a linked root. The fixture reproduced deletion outside the store. Reject linked/non-directory roots before traversing; absent raw roots remain a no-op. | Missed boundary in maintenance hardening, not a newly introduced deletion behavior. |
| AI fallback metadata incorrectly denies an attempted provider call. | HTTP failures and rejected model shapes use a fallback whose assumptions said no call occurred. Tests exercise both actual mocked request paths. Metadata now states that no usable classification was available. | Existing diagnostic error exposed by broader model validation; review requirements and automatic-action denial are unchanged. |

Tests: `tests/audit-review.test.js` and the additional fallback case in `tests/ai.test.js`. Four regressions failed before their fixes. FIFO coverage uses POSIX `mkfifo` and skips only on Windows where that primitive is unavailable; macOS and Linux execute it.

## Combined review coverage

- Maintenance: option validation before effects, purge path preflight, raw traversal boundaries, streaming retention, malformed/undated/UTF-8 lines, permission retention and temporary-file cleanup.
- AI/models: request/input/response limits, unsuccessful-body cancellation, shape validation, partial valid objects, zero confidence, fallback safety and truthful diagnostics.
- Resource readers/adapters: slab boundaries, exact byte accounting, empty/tiny fragments, iterator cleanup, per-file/batch limits, malformed-input charging, resume cursor fairness, IMAP primary-error preservation and transport cleanup.
- Dashboard/CLI: startup socket cleanup, usable IPv6 URLs, authenticated requests and nonzero readiness failure status.
- Persistence: original-record/index ordering, torn JSONL separation, journal phases and cleanup, canonical alias identity, live-owner refusal, reentrant queue ordering, and external action reconciliation remaining mandatory.
- Evidence/docs/package: benchmark scripts and heap ratchets, operational documentation, package inclusion and existing CI matrix. No new dependency or cross-repository change is required.

No further high-confidence regression was found in the reviewed changes. Tests continue to verify the supported cooperative local-filesystem model; racing hostile filesystem edits, power-loss durability, live provider delivery and unsupported platform behavior are not established by this review. The review adds no new fsync or database-transaction guarantee.

## Verification and contracts

Baseline: all 142 tests passed on the starting revision. The focused corrected maintenance/attachment/recovery suite passed 25 tests. Full post-fix verification covers 146 tests, lint, links, smoke, eval, performance and retention heap gates, dependency audit, shipcheck, doctor, and tracked-only package checks. Node 20 and Chromium run separately. Actual commands, outcomes and log hashes are in [verification.json](artifacts/2026-10-12-review/verification.json); detailed logs remain local and ignored. Exact-head remote CI proof is retained in Strata.

No configuration, environment variable, persisted item schema, backup format or HTTP shape changed. Special files and linked raw roots now fail before blocking or deleting. The AI fallback assumption text is intentionally corrected. No performance gain is claimed; existing gates enforce resource/latency expectations. All newly reproduced issues are resolved; no SignalBox capture or cross-repository follow-up is warranted.

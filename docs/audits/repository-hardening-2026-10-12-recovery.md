# Intake persistence, concurrency and interruption audit

Repository: `kujolang/intake`; branch: `main`. Starting SHA: `aeef597cb7fe32c17a01dd5cc0c8e1189d12c19b`. Ending implementation SHA: bd42b653efd106c7347699948cd0f714ccfdf69d. This final pass follows [the failure/resource audit](repository-hardening-2026-10-12-followup.md).

## Scope and evidence

Reviewed atomic record replacement, derived indexes, store and action locks, reentrant alias ownership, source cursor commit ordering, action execution uncertainty, JSONL appends, backup staging/swap/rollback and recovery initialization. The local-first JSON store and existing cooperative filesystem trust model remain unchanged. No dependencies were added or upgraded; no cross-repository change is required.

The starting revision had 131 passing tests. The initial `npm run verify` passed lint, links and those tests, but its smoke dashboard did not produce startup output within the existing four-second window. That run is recorded as failed, not a clean baseline; no timeout was increased or test weakened. The previous exact-head CI run `38338591629` was successful. New fault-injection tests independently reproduced loss of access to the original settings after recovery between restore renames, leftover previous trees after installation, alias lock deadlock and a partial log record swallowing the next event.

Detailed local logs are ignored under `artifacts/2026-10-12-recovery/`; the committed [verification receipt](artifacts/2026-10-12-recovery/verification.json) records commands, outcomes and evidence hashes. No latency/memory improvement is claimed; the existing performance gates check the cost of the new recovery and log handling.

## Changes

| Problem | Root cause and fix | Verification and compatibility |
| --- | --- | --- |
| Interrupted restore could initialize an empty target while the original remained in a sibling directory. | Directory renames had no persisted recovery plan. A sibling journal now records validated root/nonce, whether the target existed, and building/ready phases. Recovery resolves it before initialization/index rebuild. | Child processes exit immediately after journal publication and both directory renames. Original settings survive rollback; installed settings survive completed swaps. New targets can install fully prepared staging. |
| Interrupted cleanup left previous trees with no retry path. | Journal persists until cleanup succeeds. Recovery is repeatable, retains installed data and removes only journal-derived sibling trees. Exceptions preserve their primary error and report incomplete recovery. | Tests cover successful recovery, injected installation failure and original-state rollback. Invalid journals fail closed even with force. Legacy missing targets with previous-tree siblings require manual inspection instead of silent initialization. |
| Symlink restore could replace the alias rather than the locked canonical store. | Restore now uses canonical filesystem identity for the transaction and swap. | Alias remains a symlink, both paths observe restored settings, and returned `restored_to` preserves the caller's path. |
| An awaited nested alias operation deadlocked behind an independent request waiting for its outer transaction. | Canonical reentrant ownership is resolved before joining request queues, and rechecked after the asynchronous lookup. | A child-process test synchronizes on filesystem identity resolution and verifies both queued operations finish without sleeps. Live-owner exclusion and independent read/modify/write serialization remain covered. |
| A torn final JSONL record absorbed a later valid event. | Under store ownership, append reads the last byte and inserts a newline only if missing. The torn record remains intact as evidence. | A truncated JSON fixture remains a parse-error row; the next event is a separate valid row. Existing redaction and log paging tests remain active. |
| Record/index crash consistency needed stronger proof. | No behavior change required: original records remain authoritative and recovery rebuilds indexes without replay. | A child exits after record rename and before index update; normal access refuses the stale owner and recovery exposes the committed record through the index. |

Files: `src/restore-journal.js`, `src/backup.js`, `src/store-lock.js`, `src/storage.js`, `tests/recovery.test.js`, and [local storage guidance](../local-storage.md).

## Contracts and limits

Public function signatures, CLI flags, HTTP shapes, action uncertainty rules, source cursors, item/action/learning records, archive format, configuration and environment variables are unchanged. `canonicalStoreRoot` is an additive internal-module export. The new sibling journal is local operational state, outside the backup archive. Old binaries cannot interpret it: stop older writers and use the updated recovery command after interruption.

Normal access fails with `INTAKE_STORE_BUSY` while a journal remains, including if a failed operation released its ordinary lock. Recovery still refuses a live or foreign-host owner. It never replays outbound actions or removes `.action-lock`. If recovery itself crashes, the existing documented recovery-gate owner inspection still applies before rerunning it. Malformed/ambiguous journals intentionally retain evidence for operator inspection; force does not guess which data to delete.

This pass verifies abrupt **process exits**, not power-loss durability. Atomic renames are not fsync-backed transactions; network filesystems, hardware failure and non-cooperating filesystem edits retain their existing limitations. Multi-record operations remain recoverable partial progress, not database transactions. No new unresolved P0–P3 defect or external dependency was identified. Historical restores without journals need manual inspection because guessing among previous trees could lose data. This is documented migration/recovery behavior, not automatic replay.

## Verification

Post-fix release verification includes lint, documentation links, the full test suite, smoke, deterministic eval, performance/retention gates, dependency audit, shipcheck, doctor and tracked-only package validation. Separate Node 20 and Chromium checks and exact-head remote CI are recorded in the Strata handoff. See the receipt for actual outcomes. New tests extend the suite from 131 to 142. No assertions were weakened, arbitrary sleeps added, or timeout thresholds increased.

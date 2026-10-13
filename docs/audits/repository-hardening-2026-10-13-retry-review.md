# Receiver recovery regression review

Repository `kujolang/intake`, branch `main`; starting SHA `ed28fdb60e820e0529305e9ee4e99bbdb4708727`, clean checkout. Reviewed the latest receiver, source-history, Strata-export and backup-rotation fixes. Ending implementation SHA: `8e57dfab40c5dc1518f972ed77cebd3f1b1c60da`.

## Findings and corrections

| Gap | Evidence and correction | Compatibility |
| --- | --- | --- |
| Receiver lookup conflated a missing file with an authoritative JSON `null` record. Other scalar or malformed identities could be overwritten or misdirect later writes. | A regression reproduced successful redelivery overwriting `null`. Item reads now distinguish absence from invalid persisted values and check record identity against its filename. Tests cover null, false, zero, empty string, arrays, missing ID and mismatched ID. | Missing files still return null. Valid legacy items remain readable, including numeric IDs whose string form matches the filename. Invalid records fail closed before mutation. |
| Existing receipt identity and classification completion were not checked before acknowledging duplicates. | A record with a different source was accepted as a duplicate. Receiver retries now require the expected source, payload fingerprint and valid processing timestamp. Tests also cover wrong hash and unclassified records, preserving their exact bytes after refusal. | Receipt IDs/hash construction and HTTP success shapes are unchanged. Valid operator edits and changed payloads retain the prior behavior. |
| Index recovery silently omitted null/falsy item records. | A new test reproduced a successful rebuild that removed an invalid authoritative item from the derived index. Rebuilds now apply the same identity validation and fail before replacing the index. | Corruption requires operator inspection/restoration; recovery no longer reports a misleading success by silently hiding records. |

All three focused reproductions failed before their corresponding corrections. The source-history, export-completeness and backup error-propagation changes showed no further confirmed regression in this review. No speculative redesign or dependency change was made.

## Recovery proof

Eight new tests in `tests/receiver-recovery.test.js` cover:

- Actual child-process exit immediately after raw, item and index atomic renames. Requests refuse the stale lock until the documented CLI recovery runs.
- Raw-only interruption completes classification on retry; committed receipts retain operator changes and still succeed with deliberately invalid current rules, proving classification is not rerun.
- A live index-write failure leaves the classified authoritative item recoverable after the filesystem error is repaired.
- Syntactically invalid JSON, invalid JSON record values, inconsistent receipt metadata and failed index reconstruction retain evidence and fail closed.

The existing concurrent-first-delivery, concurrent-retry, restart, key-order and source-isolation tests remain active. Raw evidence stays singular and correct. Atomic item persistence remains the receipt commit point; logs and indexes are separate writes. A crash before the first classification log can leave only the committed item and a later duplicate log. No exactly-once logging, fsync/power-loss, hostile-filesystem, or live-provider delivery guarantee is added. Outbound actions are never replayed by this recovery path.

[Receiver documentation](../source-adapters.md) now explains stale-owner recovery and invalid-record handling. Public CLI/configuration/environment/backup formats and valid item schemas are unchanged. Invalid persisted state now produces explicit errors instead of being accepted as absence or a valid receipt. No cross-repository change is required. There is no performance improvement claim.

## Verification

Baseline: `npm test` passed all 155 tests at the starting SHA. The first new crash fixture needed a setup correction because a freshly initialized store need not contain an item index; this was a test setup issue, not a product failure. The focused product failures are separately retained and hashed.

Final commands and log hashes are recorded in [verification.json](artifacts/2026-10-13-retry-review/verification.json). All 163 tests passed on local Node 26.7 and Node 20.19. Full isolated release verification passed lint, documentation links, smoke, eval, benchmark/retention gates, dependency audit, shipcheck, doctor and 140-file tracked-only packaging. Chromium passed. Exact-head CI is retained in the Strata handoff after push. Verbose local logs are ignored. All confirmed findings are resolved; no new unresolved human-review or cross-repository item was admitted.

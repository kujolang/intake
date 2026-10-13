# Configuration recovery, policy controls, and doctor resource audit

Repository: `kujolang/intake`, branch `main`. Starting SHA: `f55e3fe037dde5b9bad2413f082ef13920e1712f` (clean, equal to origin/main). Ending implementation SHA: `2572cc8ad9063c7a006c8e2891cf8597391304cc`; documentation/evidence commits follow. Exact final pushed SHA and CI runs are retained in the Strata handoff.

## Scope and contracts

Intake is a local-first intake CLI/dashboard with persisted source configuration, normalized items, policy-gated actions, and email/webhook/Slack/GitHub integrations. This pass reviewed configuration replacement/export, store locks and recovery journals, policy controls and counters, doctor/resource use, action failure paths, migrations, dependency/release checks, and the receiver retry persistence work in the [previous review](repository-hardening-2026-10-13-retry-review.md). Existing receiver interruption/concurrency regressions remain enabled.

Relevant dependencies remain ImapFlow, Mailparser and Nodemailer; Playwright supplies browser verification. No dependencies, generated tool schemas, agent prompts, output protocols, environment variables, network endpoints or sibling repositories changed. There is no separate compilation/typecheck step in this JavaScript package. No token-efficiency claim or plugin-managed security scan is made. Speculative dependency removals and cosmetic rewrites were rejected.

## Baseline and reproduced failures

At the starting SHA, `npm run verify` passed lint/docs but passed only 162/163 tests: the existing fragmented-reader child exceeded its unchanged 30-second timeout. That test passed when rerun in isolation. A subsequent smoke continuation hit its existing four-second dashboard startup deadline; that continuation overlapped initial configuration edits, so it is not represented as a clean successful baseline. Local host contention was observed, but the recorded timeouts remain failures rather than being relabeled as passing checks.

Four initial configuration regressions failed before implementation: incomplete/malformed imports replaced working sections, redacted placeholders became live inline credentials, process interruption left mixed configuration, and failed export replacement destroyed existing output. Two policy regressions also failed before their corrections: a string `"false"` enabled automatic actions, and malformed rate limits/counters bypassed limits. The 64 MiB doctor fixture exhausted a 48 MiB heap before streaming.

## Changes and proof

| Problem and root cause | Implementation / affected files | Verification and compatibility |
| --- | --- | --- |
| Config import defaulted missing sections to empty arrays and wrote sections before validating later content. Redacted export markers were accepted as credentials. | `src/config-import.js` validates the complete version-1 snapshot, IDs/duplicates, section types, supported boolean settings, source basics and policy action arrays; rejects `[REDACTED]` inline tokens/signing secrets. CLI uses it before replacing config sections. | `tests/config-import.test.js` checks malformed late sections and each credential field without changing any of the four prior config files. Valid exported snapshots and numeric legacy IDs remain supported. Redacted credentials must be removed in favor of references or replaced with reviewed values. Validation is structural, not an exhaustive adapter-specific schema. |
| Independent section writes could leave a mixed snapshot after an interruption or I/O error. | A private sibling `STORE.intake-config-import.json` journal records the complete reviewed snapshot before replacement. `src/store-lock.js` blocks ordinary access while it exists, including canonical aliases. Explicit recovery installs all sections and removes the journal only after success. Competing restore/import journals fail closed. | Actual child exit after the first section rename, a live failed write, alias access, repeated recovery, malformed journal and conflicting-journal tests. Recovery never performs outbound operations. Git ignores secret-bearing journals and staged recovery trees. |
| Direct config export could truncate a previous artifact before failure. | CLI uses `writeJsonAtomic`; `src/util.js` accepts an optional file mode and creates private export/journal temp files before rename. | Fault-injected rename preserves previous output. CLI command/JSON shape stay the same; file output is atomic and owner-only. stdout output is unchanged. |
| Doctor materialized the entire audit log. | `src/doctor.js` streams UTF-8 chunks with nine characters of overlap, retaining only two match flags. `scripts/bench-doctor.mjs` supplies a repeatable separate-process fixture. | `tests/doctor-resources.test.js` covers chunk-split words/markers, UTF-8, missing logs, and 64 MiB input under a 48 MiB heap. Existing warning heuristic and error result are unchanged. |
| Truthy nonboolean enablement and NaN/negative/fractional budgets could allow automatic actions. | `src/policy.js` requires literal boolean `true`, validates limits and active-period counts as nonnegative safe integers, and fails closed on invalid limited-policy counters. Optional injected `now` permits deterministic boundary tests. | `tests/policy-config.test.js` reproduces malformed controls and preserves numeric-string limits plus zero/omitted unlimited limits. Manual action policy behavior remains distinct; this only changes invalid automatic-action controls. |

Implementation commits: `9143694` (config), `b1cbbd2` (doctor), `2572cc8` (policy). README documents the intentional configuration/recovery behavior changes.

## Measurement

The same 67,108,864-byte audit log and separate worker process were measured on Node 26.7.0. Measurements isolate the doctor edit: both measurements already included the unrelated config changes; the before value is not claimed to be a pristine-starting-SHA measurement.

| Measure | Before | After |
| --- | ---: | ---: |
| Peak worker RSS, KiB | 212,368 | 103,300 |
| Doctor elapsed time, ms | 3,295 | 1,436 |
| Log result | ok | ok |
| 48 MiB heap fixture | V8 heap exhaustion | pass |

These are single samples on a busy host, not a general latency claim. Raw values are in [doctor-before.json](artifacts/2026-10-13-config-audit/doctor-before.json) and [doctor-after.json](artifacts/2026-10-13-config-audit/doctor-after.json). The bounded-heap regression is included in normal test discovery. No binary-size, token, dependency-surface or model-cost improvement is claimed.

## Verification and limits

Final commands/results and local log SHA-256 hashes are recorded in [verification.json](artifacts/2026-10-13-config-audit/verification.json); verbose logs remain ignored. Final Node 26.7 tests passed 175/175 with `--test-concurrency=1`. The normal-concurrency local release attempt passed 174/175 and hit the same baseline reader timeout. No assertion was weakened, test skipped, delay added, or timeout increased. All remaining release gates passed sequentially against an isolated temporary store; [gates.json](artifacts/2026-10-13-config-audit/gates.json) records each command and result. Node 20.19 also passed 175/175 tests with test concurrency limited to one; Chromium and the final documentation/package checks passed. Exact-head CI is verified after push and retained in the Strata handoff.

The new journal is an internal recovery format; existing config version 1 remains unchanged. CLI exit behavior becomes failure for invalid imports rather than false success. `writeJsonAtomic`/`writeTextAtomic` gain an optional mode argument and `evaluatePolicy` an optional clock; existing valid calls are compatible. Automatic actions require the documented boolean opt-in; malformed controls fail closed. External consumers relying on partial imports, placeholder credentials or malformed truthy controls must provide valid complete configuration.

Reviewed boundaries include untrusted source payloads, local persisted state, secret-bearing export/journal files, lock ownership and canonical paths, outbound action permission checks, bounded network readers and local log processing. This adds process-interruption recovery, not fsync/power-loss durability or protection from a hostile local filesystem actor. Doctor retains its existing coarse warning heuristic, not a secret-scanner guarantee. Live provider delivery behavior was not exercised. Receiver recovery still never replays outbound actions.

No confirmed introduced regression or cross-repository requirement remains. P0/P1/P2: none newly unresolved. Needs more evidence: live-provider and machine-power-loss guarantees remain outside this local verification. P3/not worth changing: no speculative architecture rewrite, dependency deletion, or output/token churn was admitted.

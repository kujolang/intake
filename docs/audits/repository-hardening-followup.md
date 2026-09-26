# Intake hardening follow-up

Date: 2026-09-26. Repository: `kujolang/intake`; branch: `main`.
Starting SHA: `0fde2cc323508b57d1ce563245baa8e4ac79f34a`.
Ending implementation SHA: `7519ff6019e1fb9b6a73c56690310053c87f6867`.
This report/evidence is committed afterward; use `git log -1 --format=%H -- docs/audits/repository-hardening-followup.md` for its containing commit.

Scope: the open items from the [initial audit](repository-hardening.md). Intake remains a local JSON/JSONL business-message store, CLI and authenticated dashboard. Integrations remain IMAP/SMTP, OpenAI-compatible providers, signed webhooks, Strata and TotalRecall. No sibling implementation was modified.

## Baseline and findings

`npm run verify` passed all 91 tests, 21 eval cases, syntax lint, smoke, benchmark gate and dependency audit before this follow-up. No baseline failures. [Baseline timings](artifacts/followup-baseline.json) use 500 items/actions/learnings, 1,000 log events and 250 file inputs. Host: macOS, Node 26.7.0. All test state used temporary stores; live checks only authenticated/verified connections or sent synthetic AI input.

| ID | Priority | Area | Finding/evidence | Action | Status |
|---|---|---|---|---|---|
| H15 | P1 | Isolation/recovery | Config RMW, maintenance and record/index writes had no common process boundary; source persisted an item before AI completed | Exclusive sibling store lock, reentrant transaction API, guarded maintenance/receivers/CLI, explicit recovery, classify before persistence, index repair on partial sync | Implemented and regression tested |
| F02 | P2 | Browser | Token API tests did not execute dashboard JS | Headless Chromium rotates token, rejects old token, saves successfully, reloads, scrubs URL; separate CI job | Passed locally |
| F03 | P2 | External evidence | PrivateEmail/provider behavior lacked live receipt | Read-only IMAP login and SMTP verify; synthetic DeepSeek classification | Passed; no mail sent or synced |
| F04 | P2 | Resources | Full file/message buffers, unbounded batches/provider fetch | Configurable byte/item caps, bounded file reads and IMAP literals, provider deadline/input/response limits | Implemented and failure tested |
| F05 | Needs evidence | Slack | No configured Slack source/app secret reference available | Requested the missing reference; existing signed-event receiver tests retained | Blocked on external configuration |
| F06 | P2 | Measurement | Bulk filesystem variability and new lock cost | Same-size before/after benchmark plus 3 alternating standalone/transaction trials, checking every log sequence | Measured; no speculative speed claim |

## Changes and compatibility

**Store isolation/recovery (`e6ea4dd`).** `src/store-lock.js` owns a 0600 exclusive file outside the store, so restore cannot delete ownership. Same-process calls queue in invocation order; nested awaited operations reuse ownership. Different processes receive `INTAKE_STORE_BUSY` / HTTP 409 before entering the operation. There is no silent retry of remote effects or time-based lock stealing. CLI, dashboard, receivers, storage, attachments, workflow, doctor, exports, demo, retention and backup use this boundary. `store recover` checks owner host/PID and repairs three indexes. Unreadable ownership requires explicit `--force` after stopping writers. Action uncertainty still requires reconciliation; recovery never replays effects. See [operator/library contract](../local-storage.md).

Sync now refreshes the source snapshot under ownership, persists only classified items, repairs its index in `finally`, and saves the cursor only after successful classification. The regression forces failure on the second provider call: one classified item survives and is indexed; retry imports the missing item without repeating successful classification. Cross-process tests cover readers, configuration writes, retention, backup, dead owner recovery, refusal to steal live ownership, and CLI index repair. These are cooperative local-filesystem transactions, not rollback or power-loss durability guarantees; old binaries and manual file changes must be quiescent.

**Resource bounds (`88ec2c4`).** Files/email default to 25 MiB per payload, 64 MiB per batch and 1,000 batch items. Stream reads catch file growth after stat. IMAP requests one sentinel byte beyond the configured cap; oversized results are never parsed or accepted as truncated mail. Early exit closes the connection instead of draining the remaining mailbox. Provider defaults: 30-second fetch/body deadline, 1 MiB serialized input and response. Limit/timeout failures remain inspectable and retryable. Oversized files retain their existing per-file error-log/skip contract and remain eligible. Settings/flags are additive and explicit overrides preserve larger workloads. [Configuration details](../resource-limits.md). Tests cover stream cleanup, input/response bounds, cancellation, file batching, bounded IMAP requests/cleanup, and source validation.

**Browser and repeatable evidence (`f174a41`, `7519ff6`).** `scripts/browser-test.mjs` checks actual HTTP mutation responses before reload, plus browser state and errors. `npm run test:browser` and a dedicated Linux CI job run Chromium. Playwright adds development-only dependencies; four runtime dependencies are unchanged. `scripts/verify-live.mjs --email --ai` is opt-in, never syncs/sends email, and prints only result booleans or error classes.

Public record, backup and export formats and schemas are unchanged. Existing APIs/CLI commands are retained; new recovery command, source resource flags and AI config keys are additive. No environment variable was renamed. Observable changes: explicit contention errors, parent-directory permission required for ownership, resource-limit/deadline errors, and bounded sync batches. Custom library RMW/bulk callers must hold `withStoreLock` across their operation; disabled-index batch writes require an explicit rebuild before release. No downstream migration is required for Strata/TotalRecall.

## Performance, resource and output evidence

Single observed runs, milliseconds; filesystem/load variability prevents attributing all differences to code. [After](artifacts/followup-bench.json).

| Operation | Before | After |
|---|---:|---:|
| Insert 500 items (standalone calls) | 1,645 | 5,296 |
| Append 1,000 logs (standalone calls) | 570 | 3,202 |
| Sync 250 files (one transaction) | 1,646 | 1,805 |
| Repeated deduped sync | 38 | 41 |
| Warm dashboard log page | 12 | 12 |
| Warm dashboard summary | 10 | 10 |

The new standalone filesystem ownership has a real throughput cost, accepted to prevent cross-process corruption; this is not a speed improvement. Bulk consumers can amortize ownership using the transaction API already used by sync/maintenance. [Three alternating trials](artifacts/followup-lock-bench.json), same 1,000 ordered events per trial: standalone 3,168/4,313/3,990 ms; one transaction 1,033/806/739 ms. Medians 3,990 versus 806 ms. Every event and its sequence were checked. No timeout gate was raised. Dashboard/dedupe gates still pass.

Byte/count limits are deterministic bounds on accepted raw payloads, not measured total RSS guarantees; MIME expansion, indexes and directory listings still allocate memory. No token reduction, build-speed or binary-size claim. No runtime dependency growth. Quiet live receipts preserve private credentials and message data; verbose local verification logs remain in ignored `artifacts/*.log` files.

## Verification receipt

- `npm run verify` before: PASS, 91 tests, 21 evaluations, smoke/lint/bench/audit.
- `node --test tests/store-lock.test.js tests/resource-limits.test.js`: PASS (10 at that stage; source-limit input coverage added afterward).
- `node --test tests/resource-limits.test.js`: PASS, 5 tests after final resource changes.
- `npm run verify` final: PASS, 102 tests, 21 evals, lint/smoke/benchmark gate and zero dependency vulnerabilities.
- `npm run release:check`: PASS (101 tests at that point), 21 evals, smoke/lint/bench/audit, local shipcheck, doctor, package dry run. Last added source-validation test passed separately and in the final full suite.
- `npx playwright install chromium`, `npm run test:browser`: PASS including explicit rotate/save HTTP responses.
- `node scripts/verify-live.mjs --email --ai`: PASS; [safe live receipt](artifacts/followup-live.json). IMAP/SMTP authenticated; AI returned a summary without fallback. No outbound business message.
- `node scripts/bench.mjs --items 500 --logs 1000 --fileRows 250 --actions 500 --learnings 500`: PASS; artifact above.
- `node scripts/bench-store-lock.mjs`: PASS; 6 ordered-log trials, artifact above.
- `git diff --check`: PASS.

## Remaining work and external boundaries

P0/P1: no remaining validated blocker for the cooperative local-filesystem contract. Storage is not an ACID database; partial completed records and uncertain remote effects require the documented recovery procedure. P2: live Slack validation requires a configured test app/source and secret reference; this was requested but was not available. Production outage/retry/proxy/load certification requires deployment-specific evidence and is not implied by the successful connection checks. Network/shared-filesystem locking and enterprise certification remain outside the supported deployment contract. Cosmetic rewrites and speculative caching remain not worth changing.

No required cross-repository code changes. Shipcheck's static external readiness gates were not disabled to make the repository appear certified. The original H15 SignalBox capture/signal remains a historical pointer; implementation is now in this repository. No new high-signal unresolved finding was discovered beyond known external evidence requirements, so no new SignalBox capture was warranted.

## Remote verification

At implementation SHA `7519ff6019e1fb9b6a73c56690310053c87f6867`, [verify run 36223141221](https://github.com/kujolang/intake/actions/runs/36223141221) passed Node 20.19.0, 22 and 24 plus Chromium. [Artifact guard 36223141298](https://github.com/kujolang/intake/actions/runs/36223141298) passed. The subsequent commit changes only audit documentation and evidence.

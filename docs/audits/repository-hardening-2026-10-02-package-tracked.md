# Intake repository hardening follow-up — tracked-only packages

Date: 2026-10-02. Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `7f1ab72e809816f373d5385a10b495a11ec94976`. Ending implementation SHA: `4766af1`. The report commit follows the implementation commit and cannot include its own SHA.

## Repository and baseline

This pass rechecked the repository structure, runtime and release paths, package/dependency state, tests, CI, documentation, security/resource boundaries, and the package hardening introduced by the preceding pass. Intake remains a local-first Node.js CLI/dashboard integrating email, files, signed webhooks, Slack, GitHub issues/comments, OpenAI-compatible classification, Strata, and TotalRecall.

After removing an empty ignored temporary directory left by the preceding Strata handoff, the clean starting revision passed `npm run release:check`: 106 tests, smoke, 21 evals, benchmark gates, zero dependency vulnerabilities, doctor, shipcheck, and the package gate. The initial failure caused by that empty local directory was workspace residue, not a tracked repository defect. Representative warmed baseline timings were 11 ms log page, 12 ms summary, 11 ms items, 34 ms actions, 37 ms learnings, 56 ms approval audit, and 29 ms repeated dedupe.

The starting package gate rejected only a named class of known ignored files: `.log` transcripts under `docs/audits/artifacts/`. Direct comparison of the npm inventory to `git ls-files` showed that the current 110-file archive happened to be fully tracked, but the gate would not reject a future ignored or untracked file with another path or extension admitted by the broad package allowlist.

`npm audit --json` remained at zero vulnerabilities. `npm outdated --json` continued to report only the deferred ImapFlow 2.x major upgrade.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
|---|---|---|---|---|---|---|
| T01 | P1 | Supply chain / publication boundary | The package gate encoded the previously observed `.log` symptom rather than the durable rule that every published file must be tracked and reviewable. A differently named ignored file below an allowed directory could enter the archive without failing CI. | `scripts/check-package.mjs` filtered one directory/extension pair; npm's inventory and `git ls-files` provide authoritative sets for a general comparison. | Compare every npm archive entry with the tracked-file set and fail on any untracked path. | Fixed and regression tested. |
| T02 | P2 | Output efficiency | A future violation could contain many paths, making the failure receipt noisy. | The earlier implementation joined the complete rejected list. | Bound the receipt to ten paths plus a remaining-count summary. | Fixed. |
| T03 | Needs more evidence | Dependency compatibility | ImapFlow 2.x remains a major upgrade. | `npm outdated --json`; the supported IMAP behavior needs compatibility evidence before migration. | Preserve 1.7.8. | Deferred. |

## Changes implemented

`scripts/check-package.mjs` now reads the npm dry-run inventory and the NUL-delimited `git ls-files` inventory, rejects every archive path absent from version control, bounds violation output, and emits `tracked_only: true` on success. The comparison is exported as a pure function for focused behavioral coverage while the existing integration test still executes the actual package command.

`tests/shipcheck.test.js` now proves both the real tracked-only receipt and detection of an arbitrary untracked path. `docs/packaging-decision.md` documents the stronger publication invariant. The implementation is committed at `4766af1`.

## Performance and efficiency

This is a correctness and supply-chain improvement, not a package-size or runtime optimization. With this report, the final archive contains 111 tracked files at approximately 171.7 kB packed and 683.5 kB unpacked. Final warmed runtime timings remained within all existing budgets: log 14 ms, summary 10 ms, items 11 ms, actions 40 ms, learnings 45 ms, approval audit 63 ms, and repeated dedupe 44 ms. No runtime latency, memory, model-token, or dependency-count improvement is claimed.

## Security and compatibility

The release archive now has a deny-by-default reviewability property: a file cannot be published merely because it happens to sit below an allowed directory; it must also be tracked in the exact source revision. This generalizes protection against accidentally publishing local diagnostics, environment files, generated reports, or other ignored material.

The user explicitly directed this pass to skip the unavailable plugin-managed Deep Security Scan. No scan/no-findings claim is made. The connected Kujo ShipCheck Ability returned HTTP 429 and produced no receipt; local verification is not represented as Ability evidence.

- Public APIs, CLI commands, runtime behavior, config, environment variables, record/backup schemas, and integrations: unchanged.
- Package contents: unchanged for the current revision; the validation policy is stronger.
- Tests: 106 to 107.
- Cross-repository follow-ups: none.

## Remaining work

- **P0/P1:** no validated unresolved repository defect from this pass.
- **P2:** live PrivateEmail and Slack validation still require configured disposable sources and authorization for external effects.
- **Needs more evidence:** ImapFlow 2.x compatibility and deployment-specific outage/proxy/shared-filesystem/load behavior.
- **Not worth changing:** speculative caches or broad structural rewrites without measured defects.

## Verification receipt

| Command | Result |
|---|---|
| `npm run release:check` at `7f1ab72` | PASS after removing local empty `.strata-tmp`: 106 tests, smoke, 21 evals, benchmarks, zero vulnerabilities, doctor, shipcheck, tracked package. |
| `node scripts/check-package.mjs` | PASS: 111 files and `tracked_only: true`. |
| `node --test tests/shipcheck.test.js` | PASS: 5 tests, including arbitrary untracked-path detection. |
| `npm run lint` | PASS. |
| `git diff --check` | PASS. |
| `npm run release:check` | PASS: 107 tests, smoke, 21 evals, benchmarks, zero vulnerabilities, doctor, shipcheck, and tracked-only package gate. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | PASS: all 107 tests on the minimum supported Node runtime. |
| `npm run test:browser` | PASS: Chromium token rotation, revoked-token rejection, authenticated save/reload, URL scrubbing, and no page errors. |

Remote-CI results are recorded after the implementation/report commits are complete.

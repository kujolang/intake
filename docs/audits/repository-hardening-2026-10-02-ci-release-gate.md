# Intake repository hardening follow-up — remote release gate

Date: 2026-10-02. Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `d546986d24a795d2df552218671a6ce5d70c4be8`. Ending implementation SHA: `b8f9b3c`. The report commit follows the implementation commit and cannot include its own SHA.

## Repository and baseline

This pass rechecked repository source, release/package boundaries, tests, CI workflows, dependency state, documentation, and the previously added tracked-only package invariant. Intake remains a local-first Node.js CLI/dashboard integrating email, files, signed webhooks, Slack, GitHub issues/comments, OpenAI-compatible classification, Strata, and TotalRecall.

At the starting revision, `npm run release:check` passed 107 tests, smoke, 21 evals, benchmark gates, zero dependency vulnerabilities, shipcheck, doctor, and the tracked-only package check. Representative warmed baseline timings were 29 ms log page, 48 ms summary, 10 ms items, 45 ms actions, 52 ms learnings, 71 ms approval audit, and 31 ms repeated dedupe. The 111-file archive was fully tracked.

The remote Node matrix ran only `npm run verify`. That command covered lint, tests, smoke, evals, benchmarks, and dependency audit, but omitted shipcheck, doctor, and the package inventory gate contained in `npm run release:check`. Consequently, the newly strengthened publication boundary was proven locally but was not a remote-CI ratchet.

`npm audit --json` remained at zero vulnerabilities. `npm outdated --json` continued to report only the deferred ImapFlow 2.x major upgrade.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
|---|---|---|---|---|---|---|
| C01 | P1 | CI / supply chain | Remote CI did not execute shipcheck, doctor, or the tracked-only npm package gate. A publication-boundary regression could merge while every required check stayed green. | `.github/workflows/verify.yml` ran `npm run verify`; `package.json` places the missing gates only in `release:check`. | Run the full release gate across the Node 20.19/22/24 matrix. | Fixed and remotely verified. |
| C02 | P2 | Regression ratchet | Shipcheck considered a workflow valid when it ran only the narrower verify command. | `ciWorkflowCheck` searched for `npm run verify`. | Require `npm run release:check`. | Fixed and regression tested. |
| C03 | P2 | Documentation accuracy | The production-readiness queue still referred to a billing-blocked workflow and a manual bare npm pack review. | Remote CI is operational and the tracked-only checker is now authoritative. | Update current release instructions. | Fixed. |
| C04 | Needs more evidence | Dependency compatibility | ImapFlow 2.x remains a major upgrade. | `npm outdated --json`. | Preserve 1.7.8 pending compatibility evidence. | Deferred. |

## Changes implemented

`.github/workflows/verify.yml` now runs `npm run release:check` on Node 20.19, 22, and 24. This retains every prior verification step and adds doctor, shipcheck, and the tracked-only package check on every supported runtime.

`src/shipcheck.js` now fails if the workflow regresses to the narrower command. `docs/packaging-decision.md` and `docs/next-production-readiness-sweep.md` now describe the actual remote gate and the authoritative package checker. The implementation is committed at `b8f9b3c`.

## Performance and efficiency

No runtime, memory, package-size, dependency-count, or model-token improvement is claimed. CI performs three additional local-only release checks per matrix run; this is intentional proof work at the publication boundary. The browser job remains separate and unchanged. Existing benchmark thresholds remain the performance ratchet.

## Security and compatibility

This change closes an enforcement gap: ignored/untracked archive content, shipcheck regressions, or doctor failures now block the same remote matrix required for merging. The workflow retains read-only repository permissions and official Node 24 action runtimes.

The user previously directed this round to skip the unavailable plugin-managed Deep Security Scan; no scan/no-findings claim is made. The connected Kujo ShipCheck Ability returned HTTP 429 and produced no receipt; local results are not represented as Ability evidence.

- Public APIs, CLI commands, runtime behavior, data formats, configuration, environment variables, and package contents: unchanged.
- CI contract: strengthened from `verify` to `release:check` across all supported Node versions.
- Cross-repository follow-ups: none.

## Remaining work

- **P0/P1:** no validated unresolved repository defect from this pass.
- **P2:** live PrivateEmail and Slack validation still require configured disposable sources and authorization for external effects.
- **Needs more evidence:** ImapFlow 2.x compatibility and deployment-specific outage/proxy/shared-filesystem/load behavior.
- **Not worth changing:** speculative caching or broad rewrites without measured defects.

## Verification receipt

| Command | Result |
|---|---|
| `npm run release:check` at `d546986` | PASS: 107 tests, smoke, 21 evals, benchmarks, zero vulnerabilities, shipcheck, doctor, tracked-only package. |
| `node --test tests/shipcheck.test.js` | PASS: 5 tests; actual workflow satisfies the complete-release requirement. |
| `npm run lint` | PASS. |
| `git diff --check` | PASS. |
| `npm run release:check` at `3250fb2` | PASS: 107 tests, smoke, 21 evals, benchmark gates, zero vulnerabilities, shipcheck, doctor, and a 112-file fully tracked package. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | PASS: 107 tests on the minimum supported Node runtime. |
| `npm run test:browser` | PASS: Chromium token rotation, revocation, authenticated save/reload, URL scrubbing, and zero page errors. |
| GitHub Actions run `37055104572` at `9359a08` | PASS: the complete release gate ran on Node 20.19, 22, and 24; the Chromium browser job also passed. |

The final documentation-only commit is covered by the same required workflow before handoff.

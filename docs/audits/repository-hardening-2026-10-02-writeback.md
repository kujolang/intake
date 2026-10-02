# Intake repository hardening follow-up — GitHub writeback

Date: 2026-10-02. Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `886e48e09f9252ea18080cccf8e01e8416bfe2e8`. Ending implementation SHA: `a34c6b9c3746b7c8e51439e23fa790cbd6d3fa67`. The report commit follows the implementation commit and cannot include its own SHA.

## Repository and baseline

This follow-up continued the whole-repository review recorded in [repository-hardening-2026-10-02.md](repository-hardening-2026-10-02.md), with a second inspection of external network effects, resource ownership, failure semantics, configuration, dependencies, tests, release gates, and compatibility. Intake remains a local-first Node.js CLI/dashboard with IMAP/SMTP, signed webhooks, GitHub comments, OpenAI-compatible classification, Strata, and TotalRecall integrations.

At `886e48e`, `npm run verify` passed syntax lint, 103 tests, smoke, 21 evals, all benchmark thresholds, and dependency audit with zero vulnerabilities. Representative warmed baseline timings were 9 ms for a 200-row log page, 8 ms for dashboard summary, 7 ms for a 100-row item page, 29 ms for action and learning pages, 47 ms for approval audit, and 22 ms for repeated dedupe. `npm outdated --json` reported only the existing ImapFlow 2.x major upgrade, which was not adopted without compatibility evidence.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
|---|---|---|---|---|---|---|
| W01 | P1 | External effects/resources | GitHub comment writeback had no deadline and parsed the response without a byte bound. A stalled or oversized response could retain the store/action lock indefinitely or consume unbounded response memory after an externally visible POST. | `addGitHubIssueComment` was the only remaining `fetch` path without the bounds already used by AI requests. | Add configurable request deadline and request/response byte ceilings; retain uncertain-outcome semantics. | Fixed and regression tested. |
| W02 | P2 | Configuration contract | The new writeback bounds needed deterministic validation and operator documentation. | Source input already centralizes positive-integer resource validation. | Add snake/camel CLI/config aliases, validation tests, and resource-limit documentation. | Fixed. |

## Changes implemented

GitHub comment writeback now defaults to a 30,000 ms deadline, 1 MiB serialized request ceiling, and 1 MiB response ceiling. Operators may set `github_timeout_ms`, `github_max_request_bytes`, and `github_max_response_bytes` in source config or with corresponding CLI flags. Invalid values fail before network access. Oversized requests fail before the POST. The deadline covers fetch and response streaming; oversized responses stop bounded consumption.

Response JSON retains the prior malformed/empty fallback. Test doubles and other bodyless Fetch-compatible responses retain the existing `response.json()` compatibility path; real streamed response bodies use the byte-bounded reader.

Timeouts and post-send response failures intentionally flow into the existing `execution_uncertain` action state. Intake cannot know whether GitHub accepted a comment before a local timeout, so automatic retry remains forbidden until reconciliation. This preserves the prior exactly-once safety contract instead of disguising an ambiguous external effect as a clean retry.

Files: `src/adapters/issues.js`, `src/source-config.js`, `tests/issues.test.js`, `tests/source-config.test.js`, and `docs/resource-limits.md`.

## Performance and efficiency

No latency improvement is claimed. The success path adds one AbortSignal and two integer checks; network latency dominates. Deterministic resource impact is the improvement: request and response buffers are capped at 1 MiB by default and network/body wait time is capped at 30 seconds by default. The request limit prevents network work entirely when exceeded. Final warmed benchmark timings remained within all existing gates: log page 9 ms, summary 9 ms, item page 7 ms, action page 32 ms, learning page 45 ms, approval audit 54 ms, repeated dedupe 34 ms.

Runtime dependency count, package size policy, model prompts, model tokens, tool schemas, CLI output, and build steps did not change. Tests increased from 103 to 105. No memory/RSS percentage or token reduction is claimed.

## Security, compatibility, and remaining work

The change hardens one authenticated outbound trust boundary against resource exhaustion and indefinite lock retention. Repository/issue validation, token references, policy approval, action locking, response redaction, and uncertain-effect recovery remain intact. Dependency audit remains clean.

- Public functions and CLI commands: unchanged.
- File formats, record/backup schemas, environment variables, Strata and TotalRecall formats: unchanged.
- Config: three additive optional positive-integer keys/flags.
- Defaults: bounded at 30 seconds and 1 MiB request/response. Existing ordinary GitHub comments are compatible.
- External consumers: no migration required unless they intentionally relied on a request/response larger than 1 MiB or a request lasting longer than 30 seconds; explicit higher values preserve such workloads.
- Cross-repository follow-ups: none required.

Remaining classification: no validated P0/P1 repository defect from this follow-up. P2 external evidence remains live Slack validation. Deployment-specific outage/proxy/shared-filesystem/load certification still needs environment evidence. A fresh plugin-managed Deep Security Scan still requires a compatible managed-permission host; no new plugin scan claim is made. ImapFlow 2.x remains **Needs more evidence** because it is a major dependency change. Cosmetic restructuring and speculative caching remain **Not worth changing**.

## Verification receipt

| Command | Result |
|---|---|
| `npm run verify` at `886e48e` | PASS: 103 tests, smoke, 21 evals, benchmarks, zero vulnerabilities. |
| `node --test tests/issues.test.js tests/source-config.test.js tests/resource-limits.test.js tests/core.test.js` | First implementation run exposed one bodyless Fetch-mock compatibility regression; fixed without weakening the bound. Final: PASS, 33 tests. |
| `npm run lint` | PASS. |
| `git diff --check` | PASS. |
| `npm run release:check` | PASS: lint, 105 tests, smoke, 21 evals, benchmark gate, zero vulnerabilities, shipcheck, doctor, package dry run. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | PASS: 105 tests on the minimum supported runtime. |


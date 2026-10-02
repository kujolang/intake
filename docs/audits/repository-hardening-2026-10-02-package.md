# Intake repository hardening follow-up — package boundary

Date: 2026-10-02. Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `e2e986500e6beeb22fa312382bacb70f1fbe7b80`. Ending implementation SHA: `211ace2`. The report update follows the implementation commit and therefore cannot include its own SHA.

## Repository and baseline

This pass continued the implementation-led audits in this directory. Intake is a local-first Node.js CLI and dashboard for email, file, webhook, Slack, and issue intake, with approval-gated GitHub writeback, OpenAI-compatible classification, Strata export, and TotalRecall export. Important dependencies remain ImapFlow, MailParser, Nodemailer, Tabler Icons, and Playwright.

The review covered tracked and ignored package inputs, the npm release boundary, release/shipcheck scripts, runtime network and storage boundaries, dependency status, tests, CI configuration, agent-visible command output, and current documentation. The exact starting revision was `e2e986500e6beeb22fa312382bacb70f1fbe7b80` on `main`.

At the starting revision, `npm run release:check` passed lint, 105 tests, smoke, 21 evals, benchmark gates, dependency audit, shipcheck, doctor, and npm's dry-run pack. The dry run nevertheless included 34 ignored local `.log` transcripts from `docs/audits/artifacts/` because the broad `docs/` package allowlist admitted them. The archive contained 142 files, was reported as 204.7 kB packed, and 888.9 kB unpacked. Representative warmed baseline timings were 13 ms for log and summary reads, 9 ms for item reads, 42 ms for action reads, 52 ms for learning reads, 74 ms for approval audit, and 99 ms for repeated dedupe.

`npm audit --json` reported zero vulnerabilities. `npm outdated --json` reported only ImapFlow 2.2.1 versus installed/wanted 1.7.8, an existing major-version decision that remains deferred pending compatibility evidence.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
|---|---|---|---|---|---|---|
| P01 | P1 | Supply chain / release output | The release archive included 34 ignored local audit transcripts. These were not reviewed source artifacts and unnecessarily expanded the published boundary. | `npm pack --dry-run` listed every ignored `.log` below `docs/audits/artifacts/`; `.gitignore` does not filter entries admitted by the package `files` allowlist. | Exclude the logs in the package allowlist and add an executable package-content gate. | Fixed and regression tested. |
| P02 | P2 | CI / output efficiency | The release check printed the entire 142-file npm inventory but did not turn the undesired entries into a failing gate. | The old `release:check` ended with bare `npm pack --dry-run`. | Replace it with a JSON-based checker that fails on transient audit logs and emits a compact receipt. | Fixed and regression tested. |
| P03 | P2 | Documentation accuracy | Packaging documentation and shipcheck still described remote CI as blocked by billing, after verified runs had passed. | Current GitHub Actions evidence contradicted `docs/packaging-decision.md` and the old blocker wording. | Record passing remote CI and make shipcheck accurately state that remote evidence is outside its local scope. | Fixed. |
| P04 | Needs more evidence | Dependency compatibility | ImapFlow 2.x is available but is a major upgrade. | `npm outdated --json`; the existing IMAP contract and Node support need compatibility validation before adoption. | Preserve 1.7.8 for this pass. | Deferred. |
| P05 | P2 | CI supply chain | The verification workflow still used action releases backed by the deprecated Node 20 action runtime and relied on default token permissions. | GitHub run `37048650548` passed but emitted the Node 20 action-runtime deprecation annotation for checkout/setup-node. | Upgrade official checkout/setup-node actions to v7, declare read-only contents permission, and ratchet shipcheck. | Fixed; final remote CI verifies compatibility. |

## Changes implemented

`package.json` now excludes `docs/audits/artifacts/**/*.log` from the package allowlist while retaining reviewed, tracked audit reports and evidence. `scripts/check-package.mjs` runs `npm pack --dry-run --json`, rejects malformed inventories and any transient audit log that reaches the archive, and emits only filename, byte sizes, and file count. `release:check` uses this gate, and shipcheck requires both the exclusion and the gate.

The new behavior is covered by a package-level regression test that executes the actual pack gate. Documentation now describes the gate and the current remote-CI state. Files changed: `package.json`, `scripts/check-package.mjs`, `src/shipcheck.js`, `tests/shipcheck.test.js`, and `docs/packaging-decision.md`.

The verification workflows now use `actions/checkout@v7` and `actions/setup-node@v7`, whose action runtime is Node 24, and the main verification workflow explicitly grants only `contents: read`. Shipcheck ratchets these requirements so deprecated action runtimes or implicit token permissions do not silently return.

## Performance and efficiency

The package boundary changed as follows:

| Measure | Before | After |
|---|---:|---:|
| Archive entries | 142 | 110 |
| Packed size | 204.7 kB | approximately 169.4 kB |
| Unpacked size | 888.9 kB | approximately 674.9 kB |
| Transient audit `.log` entries | 34 | 0 |

The new package receipt is five fields rather than a full per-file listing during normal release checks. No runtime-latency, memory, model-token, or dependency-count improvement is claimed. Final warmed runtime timings remained within the existing gates: 8 ms log page, 7 ms summary, 6 ms item page, 27 ms action page, 32 ms learning page, 37 ms approval audit, and 21 ms repeated dedupe.

## Security and compatibility

The package manifest is a release trust boundary: ignored local command transcripts can contain machine paths, environment-specific diagnostics, or other data that was never reviewed for publication. The new allowlist exclusion prevents those transcripts from entering the archive, and the executable gate prevents silent regression. CI now uses official Node 24 action runtimes with an explicit read-only repository token permission.

A plugin-managed Deep Security Scan was requested as part of this pass but did not start because the parent host did not provide the managed filesystem permission profile required for a read-only worker. No new scan or no-findings claim is made. The previously tracked security artifacts remain historical evidence for their recorded revision only. The Kujo repository ShipCheck Ability was also unavailable because its MCP endpoint returned HTTP 404; local `intake shipcheck` and the full release gate were used as repository evidence, not represented as an Ability receipt.

- Public JS APIs and CLI commands: unchanged.
- Runtime behavior, record formats, backup formats, Strata/TotalRecall formats: unchanged.
- Configuration and environment variables: unchanged.
- Package contents: changed intentionally; ignored local `.log` transcripts are no longer published.
- Tests: increased from 105 to 106.
- External consumers: no runtime migration required.

## Cross-repository follow-ups

None required. The unavailable Kujo MCP endpoint and the host permission profile are environment/tooling limitations, not changes required in another Kujo source repository.

## Remaining work

- **P0/P1:** no validated unresolved repository defect from this pass.
- **P2:** live PrivateEmail and Slack validation still require configured disposable sources and explicit authorization for external effects.
- **Needs more evidence:** ImapFlow 2.x compatibility; deployment-specific outage, proxy, shared-filesystem, and load behavior; a fresh managed-profile Deep Security Scan.
- **Not worth changing:** speculative cache work, cosmetic restructuring, and a broad dashboard/CLI rewrite without a measured defect.

## Verification receipt

| Command | Result |
|---|---|
| `npm run release:check` at `e2e9865` | PASS: 105 tests, smoke, 21 evals, benchmark gates, zero vulnerabilities, doctor, shipcheck, and baseline dry-run package. |
| `node scripts/check-package.mjs` | PASS: 110 files, approximately 169.4 kB packed and 674.9 kB unpacked, with no transient audit logs. |
| `node --test tests/shipcheck.test.js` | PASS: 4 tests, including the real package inventory gate. |
| `npm run lint` | PASS. |
| `git diff --check` | PASS. |
| `npm run release:check` | PASS: 106 tests, smoke, 21 evals, benchmark gates, zero vulnerabilities, doctor, shipcheck, and compact package gate. |
| `npm exec --yes --package=node@20.19.0 -- node --test tests/*.test.js` | PASS: all 106 tests on the minimum supported Node runtime. |
| `npm run test:browser` | PASS: Chromium token rotation, revoked-token rejection, authenticated save/reload, URL scrubbing, and no page errors. |

The package boundary fix is committed at `df23f7c`; the CI action-runtime hardening is committed at `211ace2`. Remote CI evidence belongs to the final pushed revision and is recorded after this report update is committed.

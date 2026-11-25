# Intake dashboard performance hardening, November 25, 2026

Intake is a local-first inbox and approval workflow. This pass covers warm dashboard reads and the shared list paths behind them. The working tree started clean on `main` at `377292315d5f739fb7a2a251ea9132dc74ccca81`. The verified implementation is `1abadf8eb13b3d29a22d095f80fd2adc62c3295a`. Intake uses Node.js, local JSON/JSONL files, Tabler icons in the dashboard, and the existing IMAP and SMTP adapters for email. Strata and TotalRecall consume exported artifacts.

## Findings

| ID | Priority | Evidence and impact | Fix and status |
| --- | --- | --- | --- |
| DASH-1 | P1 | Approval audit awaited every distinct approved item's full JSON read before applying operator, type, status and date filters. It retained the full item bodies for the request. | Apply action filters first, load surviving item IDs once in batches of eight, and retain only source and risk fields. Verified current item metadata, missing items, excluded corrupt records, and CSV parity. |
| DASH-2 | P1 | Action and learning pages awaited each record file serially while holding the store lock. | Batch full-record reads with the same cap, wait for each batch to settle, and preserve index order and error propagation. Verified order and missing-file handling across a batch boundary. |
| DASH-3 | P2 | Filtered compact-index reads rebuilt filter criteria per row and built a full matching array before slicing. | Prepare criteria once and stop at the requested page boundary. Verified sparse matches, offset, zero limit and omitted limit. |

## Scope and compatibility

| Checklist phases | Evidence and scope |
| --- | --- |
| 0–2 | Inspected HTTP route dispatch in `dashboard.js`, the CLI and its release scripts, JSON index reads and rebuilds in `storage.js`, and existing dashboard tests and benchmarks. Scoped changes to repeated read work. |
| 3–4 | Measured warm end-to-end HTTP reads with sorted indexes and representative message bodies. Bounded concurrent record reads and removed full item retention from approval audit. Item-index JSON parsing and its compatibility check still read the full index. Peak RSS and cold rebuild latency were unmeasured. |
| 5–6 | `classifyWithAi` sends selected message fields under a request timeout and input/response limits. Model prompts, export handoffs, and CLI payloads were outside the dashboard-read scope. Dashboard list/detail routes provide separate payloads, and no MCP tools are registered by the dashboard. The benchmark emits a compact receipt. |
| 7–9 | Reviewed request-error recording, token gating, stored item identity checks, and the store/recovery lock in `store-lock.js`. Matching malformed records still surface the existing read error. A filtered approval audit now leaves unrelated item files unread. Reads are request-scoped and all batches settle before the lock releases. |
| 10–11 | API and CLI fields, query parameters, ordering, pagination, CSV format, storage schema and layout, config and environment contracts, and external export contracts are preserved. Dependencies and lockfile stay at the baseline revisions. |
| 12–14 | Added route regressions for filter ordering, data freshness, and missing or malformed records. The existing dashboard and retention gates remain the automated latency and resource checks. The paired benchmark records variation for local diagnosis. Updated the performance baseline instructions. |
| 15–16 | Checked the README entry points, selective Node and browser test commands, and machine-readable benchmark output. Existing index and full-record readers continue to serve their respective API consumers. No dependency or compatibility path was removed. |
| 17–18 | Implemented the three read changes in `dashboard.js`, `storage.js` and `util.js`. See verification below. |

## Performance

`node scripts/bench-dashboard-reads.mjs <baseline-checkout>` ran both revisions in one process against the same temporary store. It alternated request order, warmed each route on both revisions, and collected 12 samples each. The fixture had 3,000 items and actions, 1,500 approvals, 100 learnings and roughly 4 KB per message body. Timings cover authenticated loopback HTTP through JSON parsing on macOS 26.6.2, Intel Core i7-9750H, Node 26.12.1 and local disk.

| Warm request | Baseline median (range), ms | Current median (range), ms |
| --- | ---: | ---: |
| Filtered Inbox page, 20 items | 92.9 (28.5–150.6) | 71.3 (26.9–102.7) |
| Filtered Actions page, 100 records | 124.8 (95.9–239.7) | 85.4 (40.2–118.7) |
| Learnings page, 100 records | 78.2 (45.3–356.2) | 58.9 (44.2–101.7) |
| Approval audit, 1,500 rows | 1,487.3 (609.3–3,141.5) | 826.0 (289.1–1,759.2) |
| Approval audit CSV, 30 matches | 1,366.2 (1,050.9–1,676.3) | 24.4 (16.2–230.2) |

All five response hashes matched across all samples, including the CSV string. Item reads for the selective audit dropped from 1,500 to 30. Short requests showed substantial timing variability on the shared host, and an initial sequential comparison produced a slower Inbox median. The paired comparison controlled for run order and fixture differences. See the [paired measurements](artifacts/2026-11-25-dashboard/paired.json).

## Verification

On the starting revision, `npm run release:check` passed lint and documentation links, then passed 238 of 239 tests. The existing fragmented-reader subprocess reached its 30-second timeout during the default parallel test run. The final local verification uses two test workers and a fresh `INTAKE_DIR`.

- `node --test tests/dashboard.test.js tests/mail-editor.test.js tests/campaign-mail.test.js` passed all 26 focused tests.
- `INTAKE_TEST_CHROME=1 npm run test:browser:sources` and `INTAKE_TEST_CHROME=1 npm run test:browser:design` passed.
- `node --input-type=module -e 'import { chromium } from "@playwright/test"; const launch = chromium.launch.bind(chromium); chromium.launch = (options) => launch({ ...options, channel: "chrome" }); await import("./scripts/browser-test.mjs"); await import("./scripts/browser-mail-test.mjs");'` passed the operator and mail-editor browser workflows with the installed Chrome. The mail test uses mocked SMTP.
- `node --test --test-concurrency=2 tests/*.test.js` passed all 241 tests. `node bin/intake.js init`, `npm run lint`, `npm run docs:links`, `npm run smoke`, and `node bin/intake.js eval run` also passed. The eval suite passed all 21 cases.
- `npm run bench:gate` and `npm run bench:retention` passed with `TMPDIR` on a temporary RAM volume. The initial benchmark gate hit `ENOSPC` on the host disk.
- `node bin/intake.js shipcheck`, `node bin/intake.js doctor --json`, and `node scripts/check-package.mjs` passed.
- `npm audit --audit-level=high` passed the high-severity gate and reported three moderate dependency entries.

## Follow-up

The audit flagged recipient-parsing defects in the pinned Nodemailer 10.0.13. Intake's generic send adapter passes recipient strings to Nodemailer after newline normalization. Delivery impact in Intake remains unverified, and dependency remediation is separate from this dashboard change. [GHSA-8c8m-p3m8-cjg8](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w), [GHSA-85x2-q946-cp5h](https://github.com/advisories/GHSA-85x2-q946-cp5h).

The `ip-address` advisory has an unconfirmed Intake path. The dependency enters through the optional SOCKS support in ImapFlow, and Intake's IMAP adapter configures a direct connection.

Cross-repository dependencies require no follow-up. This comparison measures warm local HTTP reads. Live provider latency, cold rebuilds, and browser rendering time are outside its scope.

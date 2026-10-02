# Intake repository hardening — backup rotation and documentation gates

Date: 2026-10-02. Repository: `kujolang/intake`. Branch: `main`. Starting SHA: `175aded187f17404b5850ff77897114d18632a00`.

## Scope

Two consecutive review rounds covered backup lifecycle behavior, release automation, repository documentation, tests, package boundaries, dependency state, and local/remote verification. Public APIs, CLI syntax, persisted data formats, and runtime dependencies remain unchanged.

The connected Kujo ShipCheck Ability returned an MCP 404 before execution and produced no receipt. Local shipcheck evidence is not represented as connected Ability evidence. The previously skipped plugin-managed Deep Security Scan remained out of scope; no scan/no-findings claim is made.

## Findings and changes

| Round | Priority | Finding | Evidence | Resolution | Commit |
|---|---|---|---|---|---|
| 1 | P1 | `backup create --output SHARED_DIR/file.json.gz --keep N` treated every sibling `.json.gz` as an Intake backup and could delete unrelated archives. Files with future mtimes could also displace the backup just created. | `rotateBackups` selected by extension only and sorted solely by mtime. | Rotation now recognizes Intake backup headers, ignores unrelated/corrupt gzip files, and always retains the newly created archive. Regression coverage uses a shared directory, an unrelated archive, and future-dated older backups. | `2bed702` |
| 2 | P2 | README and onboarding documentation linked to four files that do not exist. Nothing in verification prevented new broken local links. | Missing readiness, release-checklist, and enterprise-checklist targets were referenced from operator entry points. | Links now point to maintained documents. A repository-wide local Markdown link checker runs in `verify`; shipcheck requires that gate; focused tests cover local, external, anchor, and fenced-example behavior. | `5836003` |

## Compatibility and efficiency

Backup rotation still accepts custom archive names and keeps the newest requested number of valid Intake archives. Header classification reads only the beginning of sibling gzip streams, avoiding full archive decompression. Unrelated or unreadable gzip files are left untouched.

The documentation gate reads tracked Markdown files and performs local filesystem checks. It adds no runtime dependency and no application-path latency. Existing benchmark thresholds remain the performance ratchet.

## Verification

| Check | Result |
|---|---|
| Backup-focused tests | PASS: 4, including shared-directory safety and current-archive retention. |
| Documentation/shipcheck-focused tests | PASS: 7. |
| `npm run docs:links` | PASS: zero broken local links. |
| `npm run release:check` | PASS: lint, documentation links, 110 tests, smoke, 21 evals, benchmark gates, zero vulnerabilities, doctor, shipcheck, and a 113-file fully tracked package. |
| Node 20.19 full tests | PASS: 110 tests. |
| Chromium browser regression | PASS: token rotation, old-token rejection, authenticated save/reload, URL scrubbing, and zero page errors. |

Representative warmed timings were 14 ms log page, 12 ms summary, 11 ms items, 55 ms actions, 52 ms learnings, 80 ms approval audit, and 42 ms repeated dedupe. No runtime performance improvement is claimed.

## Remaining evidence boundaries

- Live PrivateEmail and Slack validation still require configured disposable sources and authorization for external effects.
- ImapFlow 2.x remains a deferred major upgrade pending compatibility evidence.
- Deployment-specific outage, reverse-proxy, shared-filesystem, and load behavior remain outside the proven local contract.

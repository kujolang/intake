# Security Review: kujolang/intake

## Scope

The scan was configured for the include paths and exclusions listed below.

- Scan mode: repository
- Target kind: git_revision
- Target ID: https://github.com/kujolang/intake
- Revision: e2140681bfef3ed02f1d09812c13c6ecd908d2df
- Inventory strategy: repository
- Included paths: .
- Excluded paths: node_modules, .intake

Limitations and exclusions:
- Excluded node_modules: Dependency source not audited; npm audit and lockfile review performed.
- Excluded .intake: Live business state and credentials excluded.

### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 9 |
| Severity mix | medium: 9 |
| Confidence mix | high: 9 |
| Coverage | complete |
| Validation mode | not recorded |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Intake is a local-first Node.js operator application. bin/intake.js:2-6 loads dotenv files before CLI argument parsing; src/cli.js:59-103 dispatches initialization, sync/watch, dashboard, action approval/execution, configuration import/export, backups, retention and memory exports. Sources normalize external messages into JSON records, raw payloads and indexes, followed by rules, safety classification and optional AI (src/workflow.js:37-81,91-118). State root precedence is --dir, INTAKE_DIR, then cwd-relative .intake (src/storage.js:8-27; src/constants.js:2). Dashboard normally binds 127.0.0.1:8787; explicit non-local deployment requires opt-in, TLS and a supplied token of at least 20 characters (src/dashboard.js:65-83). Watch starts the first matching webhook/Slack/issues receiver, otherwise polls sources (src/cli.js:312-327).

### Assets

- Business message bodies, author identities, raw source payloads, attachments, classifications, actions, approvals and learnings under the configured state root (src/storage.js:12-27,102-103,158-159,181-182).
- Mailbox credentials, webhook/signing secrets, GitHub API tokens and AI API keys. References resolve from process environment or the macOS Keychain; Keychain reads use execFileSync with argument arrays (src/secrets.js:27-65). Legacy inline receiver/API secrets also remain accepted (src/adapters/webhook.js:43; src/adapters/slack.js:60; src/adapters/issues.js:64,107).
- Operator dashboard bearer authority, which protects data access and administrative mutations through one shared token rather than distinct user roles (src/dashboard.js:102-113,701-704).
- Outbound authority to send email, append an IMAP draft and comment on GitHub issues; policy configuration, global auto-action state, approval records and counters determine execution eligibility (src/workflow.js:201-270).
- Backups and Strata/TotalRecall exports contain business records and require filesystem confidentiality outside the application (src/backup.js:14-29,84-115; src/exports.js:6-18,25-62).

### Trust Boundaries

- Remote message senders control message content, and authenticated webhook clients control accepted JSON payloads. Receiver authentication precedes normalization and state writes. Generic webhook requires a constant-time bearer/query-token comparison; Slack requires timestamped HMAC; issues accept GitHub HMAC when supplied or bearer/header/query token otherwise. All receiver implementations bind loopback (src/adapters/webhook.js:40-75; src/adapters/slack.js:57-115; src/adapters/issues.js:61-96,130-135).
- Browser or HTTP client to dashboard: landing HTML and health are public, while API routes require a token supplied in Authorization, x-intake-token or query parameters. Non-local dashboard startup has separate opt-in/TLS/token constraints. The HTML sends CSP/frame protections; API replies use no-store and nosniff (src/dashboard.js:65-103,701-723). Token-bearing clients have operator authority, including source/settings and action workflows; there is no inspected evidence of tenant isolation.
- External content to action execution: rules and safety checks run before optional AI; AI suggestions can modify tags/category/queue, increase risk and require review. AI output is not directly executed (src/workflow.js:91-134). runAction re-evaluates current policy and source permissions, then requires approval unless auto_execute_allowed; email drafts become remote IMAP writes, send_response and comment_issue invoke adapters (src/workflow.js:201-257).
- Operator configuration to credential recipients: email source settings choose IMAP/SMTP hosts, defaulting to mail.privateemail.com:993 and :465; source.secret_ref supplies the password (src/adapters/email.js:172-231). AI settings or environment choose a base URL and environment key reference, and classification sends message title/body plus bearer credentials to that base URL with /chat/completions appended (src/ai.js:69-101,112-144). These are trusted operator-controlled destinations, not sender-controlled configuration.
- Approved action to external audience: email destination comes from item.author_email and body from action.body (src/adapters/email.js:75-87); GitHub repository prefers item.metadata.project over source.config.repository, with numeric issue and owner/name validation (src/adapters/issues.js:104-121). Approval currently records status/by/time rather than a payload/destination digest (src/workflow.js:179-186); dashboard edits preserve prior approval fields and can retain approved status (src/dashboard.js:322-338). This is an approval-binding investigation surface, not an independently confirmed exploit.
- Filesystem paths to sensitive reads/writes: record IDs are validated before state writes, and attachment quarantine filenames use validated source/item IDs and hashed names. Attachment download checks a lexical raw/attachments boundary and size before reading (src/storage.js:102-103,158-159,181-182; src/attachments.js:21-28,45-63). Host filesystem ownership remains a prerequisite; lexical checks do not establish isolation from a principal that can modify the state tree.
- Operator-imported backup to filesystem: restore verifies manifest format, version, path spelling, sizes and SHA-256, then optionally removes the selected target and writes files under a lexical safeJoin boundary. Import provenance is trusted operationally; checksums do not authenticate the archive author (src/backup.js:40-65,119-155).

### Attacker Capabilities

- An external sender may submit adversarial message text and attachments through a configured source; this does not imply possession of dashboard credentials, process environment, filesystem ownership or outbound API credentials.
- A local network client can contact loopback receivers but must satisfy the relevant token/signature control. Internet reachability requires an external forwarding/tunnel arrangement not established by inspected source.
- A website may induce browser requests to the local dashboard, but token authentication rather than ambient cookies is the inspected control. A token holder already has operator authority; arbitrary configuration changes by that same holder are not automatically a privilege escalation.
- A supplier of an archive or file-drop message can control its content when an operator imports it. Backup restore and export target choices belong to the operator, so security impact requires a malformed-input escape, unauthorized disclosure, or capability beyond the operator's intended import.
- A compromised AI endpoint can return classifier suggestions and receives message content when enabled. It does not obtain a direct adapter execution interface from the inspected classifier response handling (src/ai.js:74-106; src/workflow.js:123-134).

### Security Objectives

- Preserve compatibility while keeping inbound content as data, retaining source authentication and preventing unauthorized dashboard access.
- Keep local-default services loopback-bound and enforce explicit TLS/token requirements for the supported non-local dashboard deployment (src/dashboard.js:67-83).
- Prevent message/provider output from bypassing action permissions, required review, the default-disabled global auto-action switch or configured rate budgets (src/policy.js:3-44,64-84; src/storage.js:433-437).
- Bind operator approval meaningfully to the action body, type and external destination; independently inspect mutable approval state and concurrency rather than assuming source authentication supplies approval.
- Keep sensitive state, quarantine reads and restored content within intended filesystem locations, preserve credential references without disclosure, and keep backup/export recipients explicit.
- Honor documented encrypted-mail, no-attachment-execution and approval guarantees, while distinguishing enforced controls from deployment assumptions (docs/security-model.md:5-13).

### Assumptions

- This is an offline architecture review, not completed security-audit coverage. No application execution, external services, live configuration or credential material was used.
- The ordinary deployment is a trusted local operator account. No multi-user/tenant security boundary or deployed internet exposure was established.
- CLI dotenv discovery differs from state-root resolution: files are computed as join(cwd,'.env') and join(cwd,preexisting INTAKE_DIR || '.intake','.env') before CLI --dir parsing. Consequently --dir does not choose the dotenv directory; an INTAKE_DIR introduced by the first dotenv file does not change the already-built second path (bin/intake.js:5-6; src/secrets.js:5-7; src/cli.js:60-61). Absolute INTAKE_DIR behavior should be checked against Node path.join semantics, rather than assumed to read \<absolute INTAKE_DIR\>/.env.
- docs/security-model.md:6 describes secrets through environment references, but runtime additionally supports macOS Keychain and inline receiver/API credentials (src/secrets.js:35-38; src/adapters/webhook.js:43; src/adapters/slack.js:60; src/adapters/issues.js:107). Default backup exclusions cover .env and secrets/, not inline credentials residing in config JSON (src/backup.js:110-115).
- docs/security-model.md:13 says approval is required for risky/outbound actions. evaluatePolicy computes requires_human_review separately from auto_execute_allowed, whose expression does not include that review flag (src/policy.js:13-33). The parent should validate the precise supported configuration and reachable consequence before calling this a finding.
- Quarantine is opt-in and is storage containment, not malware scanning (src/attachments.js:7-28). Filesystem ACLs, encryption at rest, reverse-proxy controls, credential scopes and downstream import review are outside the inspected implementation.
- AI HTTPS acceptance and the explicit insecure-localhost escape hatch are string-prefix based; exact URL parsing and recipient restrictions require focused validation (src/ai.js:134-144).

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Auto-execution bypasses human-review requirements and rejected decisions](#finding-1) | medium | high | inline below |
| [Secret-free output omits supported inline secret fields](#finding-2) | medium | high | inline below |
| [Rule action blocks and policy confidence thresholds are descriptive only](#finding-3) | medium | high | inline below |
| [Insecure-localhost URL exception accepts external hosts](#finding-4) | medium | high | inline below |
| [Proposed rules are active before approval](#finding-5) | medium | high | inline below |
| [Restore verifies a different read from the archive it consumes and mutates before complete validation](#finding-6) | medium | high | inline below |
| [Nonmatching policies silently authorize through first-policy fallback](#finding-7) | medium | high | inline below |
| [Concurrent action runs can duplicate outbound side effects](#finding-8) | medium | high | inline below |
| [File-drop symlinks cross the inbound filesystem boundary](#finding-9) | medium | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Auto-execution bypasses human-review requirements and rejected decisions

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | authorization |
| CWE | CWE-863 |
| Affected lines | src/policy.js:13-33, src/workflow.js:201-247 |

#### Summary

Policy computes requiresHumanReview but does not include its negation in auto_execute_allowed. runAction accepts any non-executed status when auto allowance is true, including rejected. High/critical items also become eligible when the configured ceiling permits them.

#### Root Cause

Policy computes requiresHumanReview but does not include its negation in auto_execute_allowed. runAction accepts any non-executed status when auto allowance is true, including rejected. High/critical items also become eligible when the configured ceiling permits them.

#### Validation

Default global auto-actions are off and default policy blocks direct sending. No autonomous polling executor invokes runAction by itself. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

Policy computes requiresHumanReview but does not include its negation in auto_execute_allowed. runAction accepts any non-executed status when auto allowance is true, including rejected. High/critical items also become eligible when the configured ceiling permits them.

#### Reachability

Operator has enabled global/source auto-actions and a policy permits auto-execution; an agent or operator invokes run on an affected action.

#### Severity

**Medium** — Operator has enabled global/source auto-actions and a policy permits auto-execution; an agent or operator invokes run on an affected action. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Require absence of all human-review conditions for automatic execution; make rejection terminal and enforce lifecycle transitions. Preserve explicit human approval for otherwise allowed actions.

<a id="finding-2"></a>

### [2] Secret-free output omits supported inline secret fields

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | data-integrity |
| CWE | CWE-200 |
| Affected lines | src/source-config.js:83-88, src/adapters/slack.js:62, src/cli.js:235-241, src/backup.js:94-115 |

#### Summary

sanitizeSource masks token/api_token but not supported config.signing_secret. Default backup exclusions skip .env and secrets directories but copy sources.json verbatim, including supported inline token, api_token and signing_secret.

#### Root Cause

sanitizeSource masks token/api_token but not supported config.signing_secret. Default backup exclusions skip .env and secrets directories but copy sources.json verbatim, including supported inline token, api_token and signing_secret.

#### Validation

Recommended secret references do not embed values; dashboard source reads require its operator token. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

sanitizeSource masks token/api_token but not supported config.signing_secret. Default backup exclusions skip .env and secrets directories but copy sources.json verbatim, including supported inline token, api_token and signing_secret.

#### Reachability

A source uses a supported legacy inline secret and an operator shares default config export or a backup created with includeSecrets=false.

#### Severity

**Medium** — A source uses a supported legacy inline secret and an operator shares default config export or a backup created with includeSecrets=false. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Sanitize all supported inline credential fields in source output and secret-excluding backups, leaving reference fields intact; test preservation under explicit includeSecrets.

<a id="finding-3"></a>

### [3] Rule action blocks and policy confidence thresholds are descriptive only

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | authorization |
| CWE | CWE-863 |
| Affected lines | src/rules.js:6-42, src/policy.js:3-33, src/storage.js:473-475 |

#### Summary

applyRules ignores blocked_actions entirely. evaluatePolicy reads only policy-level blocked_actions and never reads confidence_threshold. Defaults and documentation advertise these controls.

#### Root Cause

applyRules ignores blocked_actions entirely. evaluatePolicy reads only policy-level blocked_actions and never reads confidence_threshold. Defaults and documentation advertise these controls.

#### Validation

Default sending block independently prevents direct sends; risk ceilings still apply to auto-execution. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

applyRules ignores blocked_actions entirely. evaluatePolicy reads only policy-level blocked_actions and never reads confidence_threshold. Defaults and documentation advertise these controls.

#### Reachability

An operator permits an action globally while relying on a matching rule to block it, or enables auto-actions while relying on confidence_threshold.

#### Severity

**Medium** — An operator permits an action globally while relying on a matching rule to block it, or enables auto-actions while relying on confidence_threshold. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Carry trusted matched-rule blocks into policy evaluation, including auto_execute, and enforce finite confidence thresholds for automatic execution.

<a id="finding-4"></a>

### [4] Insecure-localhost URL exception accepts external hosts

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | data-integrity |
| CWE | CWE-295 |
| Affected lines | src/ai.js:70-77, src/ai.js:134-144 |

#### Summary

startsWith('http://localhost') and startsWith('http://127.0.0.1') accept external suffix hosts such as localhost.attacker.example; fetch sends the selected API key as a bearer credential.

#### Root Cause

startsWith('http://localhost') and startsWith('http://127.0.0.1') accept external suffix hosts such as localhost.attacker.example; fetch sends the selected API key as a bearer credential.

#### Validation

Configuration is operator-controlled; exception is disabled by default. This is not an unauthenticated remote settings write. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

startsWith('http://localhost') and startsWith('http://127.0.0.1') accept external suffix hosts such as localhost.attacker.example; fetch sends the selected API key as a bearer credential.

#### Reachability

KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST=true and a misleading configured base URL, with AI enabled and an API key present.

#### Severity

**Medium** — KUJO_AI_SDK_ALLOW_INSECURE_LOCALHOST=true and a misleading configured base URL, with AI enabled and an API key present. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Parse URL and compare exact normalized hostname, protocol, username/password, query and fragment; use the parsed normalized value consistently.

<a id="finding-5"></a>

### [5] Proposed rules are active before approval

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | authorization |
| CWE | CWE-863 |
| Affected lines | src/cli.js:495-509, src/rules.js:10-12, src/rules.js:55-81 |

#### Summary

rules propose saves a rule with status proposed; applyRules iterates it without checking status. The separate rules approve command has no effect on eligibility.

#### Root Cause

rules propose saves a rule with status proposed; applyRules iterates it without checking status. The separate rules approve command has no effect on eligibility.

#### Validation

Proposal creation itself requires local operator execution; proposed rules do not lower existing risk and do not currently contain action blocks. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

rules propose saves a rule with status proposed; applyRules iterates it without checking status. The separate rules approve command has no effect on eligibility.

#### Reachability

Operator or agent proposes an inbound-derived rule and later classifies another matching item before review.

#### Severity

**Medium** — Operator or agent proposes an inbound-derived rule and later classifies another matching item before review. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Skip explicitly nonapproved rules while preserving existing legacy rules with no status.

<a id="finding-6"></a>

### [6] Restore verifies a different read from the archive it consumes and mutates before complete validation

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | data-integrity |
| CWE | CWE-367 |
| Affected lines | src/backup.js:54-67, src/backup.js:119-136, src/backup.js:207-221 |

#### Summary

restoreBackup verifies one decompression then decompresses again without validating that second object. Validation also accepts '.' and duplicate or file/parent-conflicting paths when their content checksums match. With force, target is deleted before extraction discovers such conflicts. Decompressed bytes are unbounded.

#### Root Cause

restoreBackup verifies one decompression then decompresses again without validating that second object. Validation also accepts '.' and duplicate or file/parent-conflicting paths when their content checksums match. With force, target is deleted before extraction discovers such conflicts. Decompressed bytes are unbounded.

#### Validation

Lexical safeJoin prevents ordinary ../ writes outside the target. Archive is local operator-selected, not accepted by a network endpoint. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

restoreBackup verifies one decompression then decompresses again without validating that second object. Validation also accepts '.' and duplicate or file/parent-conflicting paths when their content checksums match. With force, target is deleted before extraction discovers such conflicts. Decompressed bytes are unbounded.

#### Reachability

Operator restores a malformed/untrusted backup, or another local actor can replace it between reads. Force replacement is required for destruction of an existing target.

#### Severity

**Medium** — Operator restores a malformed/untrusted backup, or another local actor can replace it between reads. Force replacement is required for destruction of an existing target. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Read once with a decompressed-byte bound, validate strict entry shape and canonical unique nonconflicting file paths, stage the full store before replacement, then restore exactly the validated bytes.

<a id="finding-7"></a>

### [7] Nonmatching policies silently authorize through first-policy fallback

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | authorization |
| CWE | CWE-863 |
| Affected lines | src/policy.js:4 |

#### Summary

A failed policies.find falls back to policies\[0\], even when that policy explicitly scopes itself to a different source/category.

#### Root Cause

A failed policies.find falls back to policies\[0\], even when that policy explicitly scopes itself to a different source/category.

#### Validation

Default policy explicitly matches all sources/categories, so default behavior is unaffected. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

A failed policies.find falls back to policies\[0\], even when that policy explicitly scopes itself to a different source/category.

#### Reachability

Deployment uses scoped policies without a matching catch-all.

#### Severity

**Medium** — Deployment uses scoped policies without a matching catch-all. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Return a blocked result when no policy applies; preserve explicit wildcard behavior.

<a id="finding-8"></a>

### [8] Concurrent action runs can duplicate outbound side effects

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | data-integrity |
| CWE | CWE-362 |
| Affected lines | src/workflow.js:201-276, src/dashboard.js:312-315, src/policy.js:46-96 |

#### Summary

Each run reads status, performs external execution, and only then saves executed. Two concurrent requests can both read approved and send/comment. Automatic budget counters use read-modify-write after execution and can similarly overrun caps.

#### Root Cause

Each run reads status, performs external execution, and only then saves executed. Two concurrent requests can both read approved and send/comment. Automatic budget counters use read-modify-write after execution and can similarly overrun caps.

#### Validation

Sequential reruns return the executed record. API is authenticated; this does not independently give outsiders run access. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

Each run reads status, performs external execution, and only then saves executed. Two concurrent requests can both read approved and send/comment. Automatic budget counters use read-modify-write after execution and can similarly overrun caps.

#### Reachability

Two authenticated calls or local processes run the same action or simultaneously consume the remaining auto budget.

#### Severity

**Medium** — Two authenticated calls or local processes run the same action or simultaneously consume the remaining auto budget. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Serialize execution and budget reservations per store across supported processes, re-read status under lock, and explicitly handle crash ambiguity without claiming exactly-once network delivery.

<a id="finding-9"></a>

### [9] File-drop symlinks cross the inbound filesystem boundary

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Independent source trace; parent regression tests reproduce baseline failures and verify remediation. |
| Category | data-integrity |
| CWE | CWE-59 |
| Affected lines | src/adapters/file.js:17-38 |

#### Summary

syncFileSource uses stat, which follows symlinks, then readFile. A drop-folder entry named with a supported extension can point outside the folder and be imported as inbound content.

#### Root Cause

syncFileSource uses stat, which follows symlinks, then readFile. A drop-folder entry named with a supported extension can point outside the folder and be imported as inbound content.

#### Validation

Directory path is operator configured; exploitation requires writable local/drop filesystem access, not merely a JSON payload. Parent fixes and tests are documented in repository-hardening.md.

#### Dataflow

syncFileSource uses stat, which follows symlinks, then readFile. A drop-folder entry named with a supported extension can point outside the folder and be imported as inbound content.

#### Reachability

A less-trusted actor can add symlinks to the configured drop directory but cannot read a file the Intake account can read.

#### Severity

**Medium** — A less-trusted actor can add symlinks to the configured drop directory but cannot read a file the Intake account can read. Defaults and operator-controlled entry points limit likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Reject symlink entries and use no-follow file handles with regular-file checks; bound file size before buffering.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| CLI, dashboard, adapters, policy, state and backup boundaries | not recorded | Reported | All runtime source files reviewed independently. Findings describe baseline and are remediated; current regression receipts in ../final-verify.log. Runtime dependencies assessed through npm audit rather than vendored source review. |

## Open Questions And Follow Up

- General multi-process store transactions and retention versus append concurrency remain unsupported; use one writer and quiesce maintenance.
- Live PrivateEmail/Slack and provider outages were not tested with real credentials.

# Draft-only outreach campaigns

Intake can preserve researched outbound proposals in its local review queue and
append eligible drafts to the configured email source's IMAP Drafts folder.
This pilot interface never sends, schedules, or queues delivery. Campaign items
and actions are blocked at the SMTP adapter even if an action is changed to
`send_response` or approved through the ordinary UI.

```sh
node scripts/outreach.mjs draft /absolute/path/campaign.json .intake
```

Run this from the Intake checkout. Credentials use the existing environment or
Keychain references. No separate delivery provider is involved. The operator's
request to create drafts authorizes IMAP draft persistence only; it does not
constitute message approval for sending.

## Configuration

Keep real campaign files under the ignored `.intake/campaigns/` tree, not in the
public source repository. A campaign requires `id`, `mode: "DRAFT"`,
`sending_authorized: false`, `source_id`, `sender_email`, and up to five `prospects`.
Each prospect has `canonical_id`, `original_ids`, `name`, `identity_terms`,
`subject`, `body`, `eligible`, `email`, `contact_status`, `sources`, and `qa`.
A remotely appended draft requires `eligible: true`, `contact_status: "VERIFIED"`,
evidence references, and `qa.passed: true`. Missing contacts remain unaddressed
local proposals. `holds` prevents remote appending, including through ordinary
Intake action execution. Configuration is pinned by a content hash on first run.
Changing a saved campaign requires manual reconciliation, not a blind overwrite.

`parseResearchCsv` preserves quoted multiline fields and original source IDs.
`normalizeCollection` selects exact case-insensitive collection labels and accepts
explicit, evidence-supported identity groups. It does not silently infer industry
aliases or merge common names. Candidate groups are not necessarily verified
purchasing organizations. Review ambiguous aliases before another campaign.

## History and suppression

Every new proposal checks all local Intake items/actions and all selectable
folders in the sending mailbox using explicit business names, domains and email
addresses. IMAP folders are opened read-only. Any match is held for relationship
review, including sent mail, existing drafts, replies, opt-outs and bounces.
Failure to inspect any folder holds the proposal. This deliberately conservative
rule avoids treating a past exchange as permission for new cold outreach.

Account-wide explicit suppressions live separately in
`.intake/outreach-suppressions.json` as an array of objects with `identity` and
`reason` fields. Identity may be a canonical prospect ID, email address or one of
its configured domain/name terms. No customer CRM is connected: local records
and mailbox history are evidence, not proof about off-platform relationships.

## Persistence and recovery

Campaign state, history summaries and events live under
`.intake/campaigns/CAMPAIGN_ID/`. Intake items/actions use deterministic IDs based
on sender and canonical business ID. Every draft receives a deterministic RFC
Message-ID, and the IMAP APPEND receipt records folder, UID and UIDVALIDITY.
The local action ID is the Intake review identifier; the IMAP UID is a separate
mailbox identifier. Never label an action as a sent message.

The existing store/action locks serialize writes and reject competing writers.
An interrupted or failed append is held for reconciliation; restarting never
retries an existing action automatically. Search the mailbox for the stored
Message-ID before deciding whether any manual repair is safe. A proposal with
unknown external outcome is not a successful draft. A successful append is not
a sent email. Do not edit campaign state to force retries.

## Pilot boundaries

This implements the ASH-FIT-001 draft campaign, not the entire future autonomous
outreach specification. APPROVED/YOLO delivery, sending limits, automated reply
classification, automatic suppression ingestion, reply drafts, follow-up
scheduling and generic industry alias classification are not enabled or
implemented by this pilot. Sending cannot be activated with this command.
Those capabilities need separate implementation and acceptance tests before
live use. No delivery-readiness claim follows from successfully saving drafts.

A public business email can be attributable without its deliverability being
proven. Do not send verification messages to prospects. Include approved sender
identity, address and a clear opt-out instruction in review copy; approval of
copy and the operational opt-out process are still required before future
sending. SPF/DKIM/DMARC and provider delivery readiness are not established by
an IMAP draft operation.

## Verification

```sh
node --test tests/outreach.test.js
npm test
npm run lint
```

Tests use temporary stores and simulated append execution; no prospect receives
a test email. Coverage includes multiline research import, explicit identity
merges, missing/unverified contacts, local and remote history, account suppression,
mailbox failure, changed content, restart after success/uncertainty, sender
mismatch, disabled sending modes and delivery-boundary refusal.

### ASH-FIT-001 report export

The pilot report renderer consumes the reviewed campaign, normalization, state
and readback evidence without importing unrelated messages or credentials:

```sh
node scripts/outreach-export.mjs .intake/campaigns/ASH-FIT-001 output/ASH-FIT-001
```

It creates Markdown, CSV and JSON artifacts; ZIP those explicit outputs for
review. Its narrative and counts describe ASH-FIT-001 and should be adapted and
reverified before using it for a different pilot.

Older initialized stores may lack `append_remote_draft` in their allowed policy
actions. Do not bypass that policy or retry an uncertain append. For an explicitly
authorized campaign, configure a policy limited to the sending source and
`outreach:CAMPAIGN_ID` category, allowing `draft_response` and
`append_remote_draft`, blocking `send_response`, and retaining human review with
automatic execution disabled. A confirmed pre-execution policy block can be
reconciled after checking history again; an uncertain external result cannot.

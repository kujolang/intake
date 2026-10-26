# Outreach campaigns

Intake can preserve researched outbound proposals in its local review queue and
append eligible drafts to the configured email source's IMAP Drafts folder.
Automated draft creation never sends, schedules, or queues delivery. Individual
messages can be sent from the dashboard after explicit operator approval and
confirmation; reviewed batches can use the separate manifest workflow below.
Ordinary generic action approval alone still cannot send campaign mail.

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

## Writing review and revisions

All future Ashford campaigns use [writing policy 1.0.0](ASHFORD_OUTREACH_WRITING_POLICY.md)
and the installed `orwell-writing` skill. Before persistence, supply the prospect's
`copy`, `angle`, `observation`, `implication`, `opportunity`, dated `claims`, and
`copy_review`. Scores need eight dimension rationales, at least 34/40 and accuracy
5/5. Bind review to `copyHash(prospect)` and the campaign hash returned by
`checkCampaignCopy`. A passing hash establishes review continuity, not truth;
review the material claims and batch structure explicitly before attesting.

To update an existing campaign without changing its local action/item IDs:

```sh
node scripts/outreach.mjs revise path/to/reviewed-campaign.json .intake
```

Keep membership, sender and recipients unchanged; increase `copy_revision`.
This rechecks history and holds, replaces eligible mailbox drafts, and updates
held proposals locally. Generic action edit controls reject campaign items. The dedicated campaign
editor supports explicit operator edits and approval as described below.

IMAP requires a new UID and Message-ID for a new body. The runner reads back the
new draft before moving the old UID into `Archive/Outreach Revisions`. It retains
original records and per-message receipts in a private revision journal. A
completed exact rerun is a no-op; any pending journal blocks retries, including
changed input, until the mailbox and local records are reconciled. Never remove
a pending journal to force an automatic retry. A network interruption can leave
two versions temporarily; inspect Message-IDs before restoring a single active
draft. The archive UID is retained for later history checks where the server
provides it; missing archive identity requires manual reconciliation.

## Subsequent five-prospect batches

Keep the same campaign `id` and specify a new safe `batch_id`, such as `BATCH-002`.
The `draft` command stores that batch under `campaigns/ID/batches/BATCH_ID/`,
leaving earlier draft receipts and configurations intact. Each batch has at most
five new prospects. Supply `review_context` containing every earlier prospect's
unchanged copy/evidence and refresh editorial batch attestations across context
plus new prospects. The runner verifies context against saved configurations
and rejects omitted or changed prior copy, duplicate identities and sender drift.
Campaign-wide metadata and policy scope remain the parent campaign. Titles are
plain email subjects; campaign identification stays in metadata and tags.

## Explicitly approved delivery

An optional private `.intake/outreach-limits.json` config enforces account-wide
limits for reviewed-manifest and dashboard campaign sends. Set positive integer
`daily_limit` and `batch_limit`, and an IANA `timezone`. The guard runs inside the
shared delivery locks, counts previous campaigns and uncertain submissions, and
rejects a whole batch before SMTP when capacity is unavailable. Local midnight
resets the daily window. Missing config preserves legacy behavior; invalid config
blocks sending. Scheduling and research remain separate from this delivery guard.

An operator can now authorize a bounded set of already reviewed, eligible remote
campaign drafts with `scripts/send-reviewed-outreach.mjs`. This is separate from
draft approval and the dashboard editor. General campaign sends remain blocked.
The operator's explicit send instruction overrides the campaign's draft-only
policy only for the exact snapshots listed in a private authorization manifest.
It does not enable automatic sending or authorize future batches.

A manifest has `intent: "SEND_EXACT_REVIEWED_DRAFTS"`, `campaign_id`, `source_id`,
`approved_by`, `approved_at`, the verbatim `authorization`, and 1–10 `entries`.
Each entry contains an existing draft `action_id` and its
`outreachDeliveryFingerprint(source, action, item)`. The fingerprint binds sender,
recipient, subject, body, IDs, and draft Message-ID. Keep manifests private.

```sh
node scripts/send-reviewed-outreach.mjs --send /absolute/private/authorization.json .intake
```

Before any SMTP submission, the complete batch must pass saved-copy review,
recipient eligibility, suppression, existing-action, all-folder history, and
remote-draft checks. SMTP uses the exact approved content and existing Message-ID;
it does not add a reply thread to a first-contact message. Delivery writes a
journal before submission and saves the SMTP receipt before mailbox cleanup.
It verifies a Sent copy, then moves the original draft to the recoverable
`Archive/Outreach Sent Drafts` folder. Original draft action IDs and receipts
remain; separate executed send actions and campaign `SENT` records track delivery.
SMTP acceptance does not prove recipient inbox delivery.

A completed identical manifest is inert. Any interrupted/uncertain attempt stops
and requires receipt/mailbox reconciliation, never an automatic SMTP retry.
Changing the manifest does not bypass the existing send-action guard. Inspect
private `delivery-*.json` journals for SMTP receipts before attempting recovery.

## Manual dashboard editing and sending

Open a campaign draft, edit its subject/message, choose **Save draft**, then
**Approve draft** after reviewing the exact content. **Send email** asks for a
recipient/subject confirmation; canceling sends nothing. This explicit operator
workflow is an exception to draft-only automation policy for that one message,
not a policy change or an authorization for unattended sending. Contact holds,
suppression, verified recipients, sender identity, and prior delivery checks
remain enforced. An edit invalidates the previous approval.

See [the email editor guide](mail-editor.md) for API fields and persistence.
Operator review is recorded separately from the scored agent-copy workflow.
The UI preserves original IDs and draft receipts. It sends the saved local text;
it does not replace or delete the older mailbox draft. The success message makes
that distinction explicit. Sent and uncertain messages are locked against retries,
and automated drafting/revision cannot overwrite their operator state. Messages
already submitted by the reviewed-batch CLI cannot be sent again from this UI.

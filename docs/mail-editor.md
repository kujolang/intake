# Email drafts in the dashboard

Open an email item to edit its saved draft in the reading pane. The version menu
lists drafts associated with that item, including drafts created by agents.
Use **Compose email** beside the Intake heading to start a new message. Select an
enabled email account, enter a recipient, subject and message, then **Save draft**.
Saving is local and does not send or append to IMAP. Expand **Mailbox actions**
to save an approved copy to the account’s Drafts folder. A reply keeps its original
item and thread. Editing a previously appended ordinary draft creates a new local
action; it does not replace the existing mailbox draft.

**Send email** sends the saved version after recipient confirmation. Unsaved edits
must be saved first. The existing source and action policies still apply, so a
blocked send reports its reason rather than claiming delivery. An uncertain result
requires reconciliation; the editor does not retry it. Repeated send requests use
the same action identity. Editing clears previous approval.

Campaign drafts use **Save draft → Approve draft → Send email**. Save edits the
existing local item/action in place and clears approval. Approve records the
operator's review of the exact recipient, subject, body and sending identity; it
does not send. Send displays a recipient/subject confirmation before delivery.
Cancel leaves the approved draft unsent. Changing content or the sending identity
invalidates approval. Legacy review proposals appear in the editor and must be
saved before approval.

Manual operator approval is separate from the scored review required for
agent-authored campaign copy. It authorizes one explicitly confirmed message,
including through the authenticated API, without enabling unattended campaigns
or changing draft-only automation policy. Recipient verification, suppression,
relationship holds, pending revision recovery and previous delivery checks still
apply. The verified recipient stays fixed. Sent or uncertain messages cannot be
edited or resent. SMTP acceptance is recorded as sent; it is not inbox delivery
confirmation.

Edits are local. This UI does not replace or remove the older IMAP draft; after a
send, it explicitly says that the earlier mailbox draft remains unchanged. Do not
send that older copy separately. Original draft IDs and append receipts remain,
while `campaign_review`, `campaign_delivery`, campaign state and audit events
record the manual workflow. Automated campaign replay/revision cannot overwrite
these operator edits or sent status. The separate reviewed-batch delivery CLI
continues to use its own stricter remote-copy and mailbox-cleanup workflow; the
UI refuses messages already submitted through that workflow.

## Agent API

All requests require the dashboard token, for example in `x-intake-token`.

- `GET /api/items/:id/mail` returns related actions and their `version` tokens.
- `POST /api/mail/compose` takes `source_id`, `to`, `subject`, and `body`.
- `POST /api/mail/reply` takes the same fields plus `item_id`.
- `POST /api/mail/save/:actionId` takes `version`, `to`, `subject`, and `body`.
- `POST /api/mail/approve/:actionId` takes `version` and `reviewed: true` for campaigns.
- `POST /api/mail/proposal/:actionId` is a compatibility alias for campaign save.
- `POST /api/mail/append/:actionId` takes `version` and `confirm: true` to append a saved draft.
- `POST /api/mail/send/:actionId` takes the saved `version` and `confirm: true`.

A changed action returns HTTP 409; reload and review the newer version before
resubmission. Sending through this API requires the user's explicit authorization,
just as sending through the CLI does. No real emails are sent by the automated
editor tests.

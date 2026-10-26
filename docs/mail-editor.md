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

Campaign drafts show **Save for review**. This stores a `revision_proposal` on the
existing action without changing reviewed copy, campaign state or the remote
mailbox draft. The recipient remains fixed. Agents can read the proposal and
incorporate it into the existing reviewed `outreach revise` workflow. Proposals
are not copy approval. Campaign sending remains disabled for both humans and
agents; the editor does not bypass that boundary.

## Agent API

All requests require the dashboard token, for example in `x-intake-token`.

- `GET /api/items/:id/mail` returns related actions and their `version` tokens.
- `POST /api/mail/compose` takes `source_id`, `to`, `subject`, and `body`.
- `POST /api/mail/reply` takes the same fields plus `item_id`.
- `POST /api/mail/save/:actionId` takes `version`, `to`, `subject`, and `body`.
- `POST /api/mail/proposal/:actionId` takes `version`, `subject`, and `body` for campaigns.
- `POST /api/mail/append/:actionId` takes `version` and `confirm: true` to append a saved draft.
- `POST /api/mail/send/:actionId` takes the saved `version` and `confirm: true`.

A changed action returns HTTP 409; reload and review the newer version before
resubmission. Sending through this API requires the user's explicit authorization,
just as sending through the CLI does. No real emails are sent by the automated
editor tests.

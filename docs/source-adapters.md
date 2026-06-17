# Source Adapters

Adapters connect to sources, store raw payloads, normalize source-specific fields, and report capabilities.

Current adapters:

- `manual`: direct local item creation.
- `file`: local folder sync for `.txt`, `.md`, `.json`, and `.eml`.
- `webhook`: generic token-authenticated JSON receiver.
- `slack`: signed Slack Events API receiver with URL verification.
- `github`: token-authenticated GitHub issue and pull request webhook receiver.
- `jira`: token-authenticated Jira issue webhook receiver.
- `linear`: token-authenticated Linear issue webhook receiver.
- `clickup`: token-authenticated ClickUp task webhook receiver.
- `email`: IMAP sync and remote Drafts append for approved draft actions.

Core logic detects capabilities instead of assuming every source can send, comment, label, or update remote state.

Issue-tracker adapters normalize provider payloads into the same `IntakeItem` shape as email and Slack. They preserve raw JSON payloads, map provider issue IDs into source-scoped dedupe keys, and tag records with the provider name for filtering.

Use `intake templates list` to discover setup templates for common systems. New adapters should follow [adapter-authoring.md](adapter-authoring.md).

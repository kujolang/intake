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

## Receiver retries

Generic webhooks, Slack events, and issue webhooks identify new receipts by a SHA-256 hash of the source ID, source type, and canonical JSON payload. Object key order does not change identity. A retry returns HTTP 202 with the original `item_id`, preserves operator changes, repairs the derived item index, and logs a skipped duplicate without rerunning classification or rewriting raw evidence. A changed payload creates a separate item even when its native entity ID is unchanged. Classification completes before the item is persisted; a failed classification can be retried.

Receiver item IDs are opaque `itm_`-prefixed hashes, with an additive `metadata.receipt_hash` field. Existing IDs, direct normalizers, imports and source cursors remain supported. Historical receipts created before this change are not retroactively fingerprinted: their first redelivery after upgrade can create a new item. Deleting the receipt item ends its dedupe lifetime. This is exact-payload idempotency; providers that change delivery metadata inside the JSON create distinct receipts. Transport signatures and retry headers are not part of the payload hash.

Editing a source preserves its stored connection-test and sync history, latest results, timestamps, and cursor. Input fields cannot replace that server-owned history.

After an abrupt receiver process exit, the store remains locked until the exited owner is reconciled with `intake store recover --dir STORE`. Recovery rebuilds derived indexes; retry the delivery afterward. A raw-only interrupted receipt is classified on retry. If the classified item was committed before interruption, retry preserves that item and does not evaluate rules again. Recovery does not replay outbound actions. Malformed authoritative item JSON (including null/scalar values or mismatched IDs), inconsistent receipt source/hash, and unclassified receipts fail closed and are not overwritten by redelivery; inspect/restore the evidence before retrying. A live process reporting a storage error releases its lock normally; repair the underlying filesystem error before redelivery.

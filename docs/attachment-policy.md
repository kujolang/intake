# Attachment Policy

Default behavior: metadata-only.

Email and file adapters record attachment metadata such as filename, content type, size, and checksum when available. Intake does not execute, open, or automatically process attachments.

## Current Rules

- Store raw inbound payloads for audit.
- Extract attachment metadata only.
- Treat filenames and content types as untrusted.
- Do not auto-open links or attachments.
- Route security-sensitive attachment language to human review through rules/safety.

## Future Optional Quarantine

Before enabling attachment extraction, add:

- Quarantine directory outside normal raw payload browsing.
- Size limits per attachment and per message.
- Content type allowlist.
- Hash inventory.
- Manual release workflow.
- Malware scanning integration point.

Until those controls exist, metadata-only is the production-safe default.

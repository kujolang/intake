# Attachment Policy

Default behavior: metadata-only.

Email and file adapters record attachment metadata such as filename, content type, size, and checksum when available. Intake does not execute, open, or automatically process attachments.

## Current Rules

- Store raw inbound payloads for audit.
- Extract attachment metadata only.
- Treat filenames and content types as untrusted.
- Do not auto-open links or attachments.
- Route security-sensitive attachment language to human review through rules/safety.
- When a source enables quarantine, store attachment bytes under `.intake/raw/attachments/`.
- Keep item records metadata-only even when attachment bytes are quarantined.
- Show sanitized attachment inventory in the dashboard.
- Allow explicit dashboard download of quarantined attachments through a token-authenticated API.
- Record attachment downloads in the audit log.
- Reject quarantine paths outside `.intake/raw/attachments/`.
- Enforce a 25 MB per-download limit.

## Remaining Hardening

Before treating attachment workflows as enterprise-complete, add:

- Content type allowlist.
- Malware scanning integration point.
- Operator role separation for attachment release.
- Optional attachment export directory separate from browser downloads.

Until those controls exist, metadata-only remains the safest default for new sources.

# Adapter Authoring Guide

Adapters translate external systems into Intake's internal `IntakeItem` workflow.

## Adapter Contract

Every adapter should prove:

- `capabilitiesFor(type)` returns stable capabilities.
- `testSource(source)` validates required config and secrets without destructive side effects.
- `validateSourceConfig(source)` returns actionable setup errors.
- Sync or receive flow stores raw payloads.
- Normalization creates deterministic `IntakeItem` fields.
- Dedupe prevents repeated imports.
- Classification runs after ingest.
- Errors are written to `.intake/logs/errors.jsonl`.

## Source Shape

Sources live in `.intake/config/sources.json`:

```json
{
  "id": "support-email",
  "name": "Support Email",
  "type": "email",
  "enabled": true,
  "secret_ref": "env:INTAKE_SUPPORT_EMAIL_PASSWORD",
  "config": {},
  "default_queue": "support",
  "capabilities": []
}
```

Do not store passwords, API keys, or signing secrets directly in ordinary source config. Prefer:

- `env:NAME`
- `keychain:SERVICE:ACCOUNT`

## Normalization Guidance

Map external data into:

- `source_id`
- `source_type`
- `source_native_id`
- `source_thread_id`
- `source_url`
- `title`
- `body`
- `author`
- `author_email` or `author_id`
- `participants`
- `received_at`
- `queue`
- `tags`
- `metadata`

Store the raw payload first, then attach `raw_payload_path`.

## Safety Requirements

- Enforce request body size limits.
- Verify webhook signatures or tokens in constant time.
- Redact secrets from logs.
- Treat all inbound content as untrusted data.
- Do not auto-execute outbound side effects from adapter code.

## Existing Examples

- `src/adapters/email.js`: IMAP/SMTP readiness, sync, draft append.
- `src/adapters/webhook.js`: generic token-authenticated JSON receiver.
- `src/adapters/slack.js`: signed Slack Events API receiver.
- `src/adapters/file.js`: local folder sync and `.eml` parsing.
- `src/adapters/manual.js`: direct local item creation.

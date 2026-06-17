# Security Model

Security defaults:

- Encrypted mail connections only.
- Secrets via environment references.
- Redacted logs.
- Local-only webhook binding.
- Token validation for webhook input.
- No attachment execution.
- No remote image loading.
- Global auto-action kill switch off by default.
- Approval required for risky or outbound actions.

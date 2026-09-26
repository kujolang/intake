# Security Model

Security defaults:

- Encrypted mail connections only.
- Secrets preferably via environment or macOS Keychain references; supported inline secrets are masked in source exports and omitted from default backups.
- Redacted logs.
- Local-only webhook binding.
- Token validation for webhook input.
- No attachment execution.
- No remote image loading.
- Global auto-action kill switch off by default.
- Approval required for risky or outbound actions.

Action review, confidence and rule vetoes are enforced together. External execution is locked and uncertain outcomes require reconciliation. See [the hardening audit](audits/repository-hardening.md) for evidence and explicit limits.

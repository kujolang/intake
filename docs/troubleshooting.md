# Troubleshooting

Run `intake doctor` first. It checks folders, source configs, secrets, auto-action state, policies, rules, and logs.

Common issues:

- Missing email password env var: export the env var named by `secret_ref`.
- Insecure mail config: remove `--insecure`.
- Webhook unauthorized: use the configured bearer token or `?token=...`.
- No items after file sync: verify the source path and supported extensions.
- Dashboard unauthorized: open the tokenized URL printed by `intake dashboard`, set `INTAKE_DASHBOARD_TOKEN`, or pass `--token`.

## Email Readiness Matrix

Run:

```sh
intake source test SOURCE_ID
```

Use the failing gate to diagnose:

| Gate | Common failure | Fix |
| --- | --- | --- |
| `config` | `missing email username` | Set `Username` to the full mailbox address, for example `support@example.com`. |
| `config` | `insecure IMAP/SMTP config is blocked` | Use SSL ports, usually IMAP `993` and SMTP `465` for PrivateEmail. |
| `config` | missing secret | Set `Password env` or Keychain fields on the source. |
| `imap` | missing env var | Add the exact env var to `.env` or `.intake/.env`, then restart the CLI/dashboard. |
| `imap` | authentication failed | Verify the mailbox password, not the hosting account password. |
| `imap` | connection timeout | Confirm host, port, firewall, VPN, and provider status. |
| `imap` | mailbox missing | Confirm `Mailbox` is `INBOX` or a provider-valid folder. |
| `smtp` | authentication failed | Confirm SMTP auth is enabled for the mailbox and password is correct. |
| `smtp` | connection timeout | Confirm SMTP host/port and local network egress rules. |
| draft run | Drafts mailbox missing | Set the provider-specific drafts mailbox name on the source. |

PrivateEmail defaults:

- IMAP SSL: `mail.privateemail.com:993`
- SMTP SSL: `mail.privateemail.com:465`

## Slack Events

- `401 unauthorized`: Slack signature is missing, stale, or signed with the wrong signing secret.
- URL verification fails: confirm `intake watch --source SOURCE_ID` is running and the Slack request URL points to the printed local receiver URL.
- No item appears: check `.intake/logs/errors.jsonl` and `.intake/logs/sync.jsonl`.

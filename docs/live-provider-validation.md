# Live Provider Validation

Live checks are explicit and non-mutating. They never sync messages, create drafts, send replies, or change provider configuration.

## Email

Run:

```sh
npm run verify:live:email
```

The command loads the enabled email source and its configured secret reference, then authenticates to both IMAP and SMTP. Output is limited to boolean connection results; mailbox addresses, credentials, and message contents are not printed.

Evidence on 2026-10-02:

```json
{
  "email": {
    "ok": true,
    "imap": true,
    "smtp": true
  }
}
```

This proves the configured mailbox can establish both inbound and outbound provider connections. It does not prove message ingestion or delivery; those require a disposable mailbox and an explicitly authorized end-to-end test.

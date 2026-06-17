# PrivateEmail Setup

Use the standard encrypted Namecheap PrivateEmail endpoints:

- IMAP SSL: `mail.privateemail.com:993`
- SMTP SSL: `mail.privateemail.com:465`

Example:

```sh
export INTAKE_SECRET_SUPPORT_PASSWORD="mailbox-password"
intake source add email --id support-email --username support@example.com --password-env INTAKE_SECRET_SUPPORT_PASSWORD
intake source test support-email
intake sync support-email
```

Insecure IMAP/SMTP config is blocked by default.

The CLI and dashboard auto-load `.env` and `.intake/.env`, so you can persist local development secrets there. `.env` is ignored by git. For encrypted local storage on macOS, use Keychain and set the source `secret_ref` to `keychain:kujo-intake:support@example.com`.

## Local Secret Options

`.env` or `.intake/.env`:

```sh
INTAKE_SECRET_SUPPORT_PASSWORD="mailbox-password"
```

macOS Keychain:

```sh
security add-generic-password -s kujo-intake -a support@example.com -w "mailbox-password" -U
intake source add email --id support-email --username support@example.com --keychain-service kujo-intake --keychain-account support@example.com
```

## Multiple Inboxes

Add one source per inbox. Keep each inbox in a separate queue so live testing is easy to inspect:

```sh
intake source add email --id support-email --username support@example.com --password-env INTAKE_SUPPORT_EMAIL_PASSWORD --queue support
intake source add email --id sales-email --username sales@example.com --password-env INTAKE_SALES_EMAIL_PASSWORD --queue sales
intake source add email --id billing-email --username billing@example.com --password-env INTAKE_BILLING_EMAIL_PASSWORD --queue billing
```

Run `intake source test SOURCE_ID` for each one. The result should show `config`, `imap`, and `smtp` as passing before you expect live sync or draft creation to work.

## First Live Test

1. Run `intake doctor`.
2. Run `intake source test support-email`.
3. Send a fake email to that mailbox.
4. Run `intake sync support-email`.
5. Open the dashboard, classify the item, draft a response, approve it, and run the draft action.

The safe default is draft-only: direct sending is blocked by policy, while approved draft responses are appended to the mailbox Drafts folder.

# End-To-End Tutorial

This tutorial walks through a complete local Intake flow with PrivateEmail.

## 1. Initialize

```sh
npm install
node bin/intake.js init
```

## 2. Add A PrivateEmail Source

Store the mailbox password:

```sh
cat >> .intake/.env <<'EOF'
INTAKE_SUPPORT_EMAIL_PASSWORD="mailbox-password"
EOF
```

Add the source:

```sh
node bin/intake.js source add email \
  --id support-email \
  --name "Support Email" \
  --username support@example.com \
  --password-env INTAKE_SUPPORT_EMAIL_PASSWORD \
  --queue support
```

## 3. Test The Source

```sh
node bin/intake.js source test support-email
```

Confirm:

- config: OK
- imap: OK
- smtp: OK

## 4. Send A Test Email

Send a harmless message to the mailbox:

```text
Subject: Test support question

How do I configure PrivateEmail with Intake?
```

## 5. Sync

```sh
node bin/intake.js sync support-email
node bin/intake.js items --source support-email
```

## 6. Review In Dashboard

```sh
node bin/intake.js dashboard --port 8787
```

Open the printed URL, select the item, classify it, and create a draft.

## 7. Approve And Run Draft

Approve the draft action, then run it. For email sources, `draft_response` appends a draft to the remote Drafts mailbox. It does not send by default.

## 8. Export Learning

```sh
node bin/intake.js learn ITEM_ID
node bin/intake.js strata daily
node bin/intake.js totalrecall export
```

## 9. Back Up

```sh
node bin/intake.js backup create
node bin/intake.js backup verify .intake/backups/intake-backup-YYYYMMDDHHMMSS.json.gz
```

## 10. Clean Up Test Data

Preview before purging:

```sh
node bin/intake.js purge items --source support-email --dry-run
```

Apply only when you are sure:

```sh
node bin/intake.js purge items --source support-email --force
```

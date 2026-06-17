# Release Checklist

Use this checklist before publishing or presenting Kujo Intake as a release candidate.

## Code Gate

- Run `npm run verify`.
- Confirm unit, smoke, eval, and audit gates pass.
- Confirm `node bin/intake.js doctor` passes against a clean demo store.
- Confirm root files are intentional: `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `.gitignore`.

## Source Gate

- Run `intake templates list`.
- Run `intake demo seed email`.
- Open the dashboard and verify Items, Sources, Actions, Learnings, Rules, and Audit render.
- Run `intake demo clear`.
- Run `intake backup create`, `intake backup verify`, and restore into an empty target.

## Live Email Gate

- Configure a disposable PrivateEmail mailbox.
- Confirm `intake source test SOURCE_ID` passes config, IMAP, and SMTP.
- Send a harmless test email.
- Confirm `intake sync SOURCE_ID` imports exactly one item.
- Create, approve, and run a draft action.
- Confirm the draft appears in the remote Drafts mailbox.
- Confirm direct `send_response` remains blocked by default policy.

## Slack Gate

- Configure a disposable Slack app with Events API.
- Set the signing secret through `env:` or Keychain.
- Run a Slack source with `intake watch --source SOURCE_ID`.
- Complete Slack URL verification.
- Send a test message event.
- Confirm the item is normalized, classified, and auditable.

## Data Lifecycle Gate

- Run a dry-run retention command.
- Run a dry-run item purge command.
- Confirm forced purge only removes selected items and linked actions/learnings/raw payloads.
- Confirm backup excludes `.intake/.env` and `.intake/secrets/` unless `--include-secrets` is passed.

## Packaging Gate

- Confirm package name, description, keywords, license, repository, and bin entry.
- Confirm whether `"private": true` should remain.
- Confirm changelog entry and version number.
- Tag the release only after the above gates pass.

# Example Packs

These packs are starter operating profiles. They are intentionally plain: add sources, set queues, keep direct send blocked, and use reviewed draft actions until the workflow has been proven with live traffic.

## Agency Support

Sources:

- `support-email`: `email`, queue `support`.
- `client-work-jira`: `jira`, queue `client-work`.
- `client-clickup`: `clickup`, queue `client-work`.

Suggested queues:

- `support`
- `client-work`
- `needs-review`
- `human-review`

Useful commands:

```sh
intake source add email --id support-email --name "Support Email" --username support@example.com --password-env INTAKE_SUPPORT_EMAIL_PASSWORD --queue support
intake source add jira --id client-work-jira --name "Client Jira" --password-env INTAKE_JIRA_WEBHOOK_TOKEN --path /webhook/jira --queue client-work
intake source add clickup --id client-clickup --name "Client ClickUp" --password-env INTAKE_CLICKUP_WEBHOOK_TOKEN --path /webhook/clickup --queue client-work
```

## SaaS Support

Sources:

- `support-email`: customer support mailbox.
- `github-issues`: product bugs and regressions.
- `slack-support`: internal support escalation channel.

Suggested routing:

- Bug language routes to `engineering`.
- Credential or account access language routes to `human-review`.
- FAQ candidates become reviewed learnings.

Useful commands:

```sh
intake source add github --id github-issues --name "GitHub Issues" --password-env INTAKE_GITHUB_WEBHOOK_TOKEN --path /webhook/github --queue engineering
intake source add slack --id slack-support --name "Slack Support" --password-env INTAKE_SLACK_SIGNING_SECRET --path /slack/events --port 8766 --queue engineering
```

## Solo Founder

Sources:

- `inbox`: primary mailbox.
- `manual`: quick local capture.
- `linear`: product task intake.

Operating mode:

- Review every outbound draft.
- Export learnings weekly to Strata and TotalRecall.
- Keep backups rotated locally.

Useful commands:

```sh
intake backup create --keep 7
intake strata daily
intake totalrecall export
```

## Internal Ops

Sources:

- `ops-email`: vendor and internal requests.
- `ops-webhook`: generic automation events.
- `ops-slack`: signed Slack event stream.

Suggested controls:

- Keep auto-actions disabled while onboarding.
- Use `policy preview` before changing policy gates.
- Run restore drills before adding production credentials.

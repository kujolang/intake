export const SOURCE_TEMPLATES = [
  {
    id: "privateemail",
    type: "email",
    name: "Namecheap PrivateEmail",
    description: "IMAP/SMTP inbox source for PrivateEmail mailboxes.",
    defaults: {
      imap_host: "mail.privateemail.com",
      imap_port: 993,
      smtp_host: "mail.privateemail.com",
      smtp_port: 465,
      mailbox: "INBOX",
      queue: "support"
    }
  },
  {
    id: "slack-events",
    type: "slack",
    name: "Slack Events API",
    description: "Signed Slack Events API receiver with URL verification.",
    defaults: {
      port: 8766,
      path: "/slack/events",
      queue: "engineering",
      password_env: "INTAKE_SLACK_SIGNING_SECRET"
    }
  },
  {
    id: "github-webhook",
    type: "github",
    name: "GitHub Webhook",
    description: "GitHub issue and pull request webhook intake.",
    defaults: {
      port: 8765,
      path: "/webhook/github",
      queue: "engineering",
      password_env: "INTAKE_GITHUB_WEBHOOK_TOKEN"
    }
  },
  {
    id: "jira-webhook",
    type: "jira",
    name: "Jira Webhook",
    description: "Jira issue webhook intake.",
    defaults: {
      port: 8765,
      path: "/webhook/jira",
      queue: "client-work",
      password_env: "INTAKE_JIRA_WEBHOOK_TOKEN"
    }
  },
  {
    id: "linear-webhook",
    type: "linear",
    name: "Linear Webhook",
    description: "Linear issue webhook intake.",
    defaults: {
      port: 8765,
      path: "/webhook/linear",
      queue: "engineering",
      password_env: "INTAKE_LINEAR_WEBHOOK_TOKEN"
    }
  },
  {
    id: "clickup-webhook",
    type: "clickup",
    name: "ClickUp Webhook",
    description: "ClickUp task webhook intake.",
    defaults: {
      port: 8765,
      path: "/webhook/clickup",
      queue: "client-work",
      password_env: "INTAKE_CLICKUP_WEBHOOK_TOKEN"
    }
  }
];

export function listSourceTemplates() {
  return SOURCE_TEMPLATES.map(({ id, type, name, description }) => ({ id, type, name, description }));
}

export function getSourceTemplate(id) {
  return SOURCE_TEMPLATES.find((template) => template.id === id) || null;
}

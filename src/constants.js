export const VERSION = "0.1.0";
export const DEFAULT_INTAKE_DIR = ".intake";
export const STORAGE_SCHEMA_VERSION = 1;

export const STATUS = [
  "new",
  "triaged",
  "queued",
  "assigned",
  "needs_review",
  "draft_ready",
  "approved",
  "in_progress",
  "waiting_on_user",
  "waiting_on_external",
  "resolved",
  "ignored",
  "blocked",
  "failed"
];

export const QUEUES = [
  "inbox",
  "needs-review",
  "agent-ready",
  "human-review",
  "support",
  "sales",
  "billing",
  "bug-report",
  "release-regression-watch",
  "faq-candidates",
  "docs-needed",
  "engineering",
  "client-work",
  "resolved",
  "blocked"
];

export const RISK_LEVELS = ["low", "medium", "high", "critical"];

export const ACTION_STATUSES = [
  "proposed",
  "needs_review",
  "approved",
  "rejected",
  "executed",
  "failed",
  "blocked"
];

export const LEARNING_STATUSES = [
  "proposed",
  "reviewed",
  "accepted",
  "rejected",
  "exported",
  "deprecated"
];

export const REQUIRED_DIRS = [
  "config",
  "secrets",
  "raw/email",
  "raw/webhooks",
  "raw/files",
  "raw/manual",
  "raw/attachments",
  "items",
  "actions",
  "learnings",
  "index",
  "logs",
  "strata/daily",
  "totalrecall/exports",
  "evals",
  "docs",
  "specs",
  "backups"
];

export const LOG_NAMES = [
  "sync",
  "normalize",
  "classify",
  "policy",
  "actions",
  "audit",
  "errors"
];

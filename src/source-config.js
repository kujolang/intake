import { capabilitiesFor } from "./adapters/index.js";
import { makeSource } from "./models.js";
import { validateSecretRef } from "./secrets.js";
import { assertSafeId } from "./util.js";

export function buildSourceFromInput(input, existing = null) {
  if (input.password) throw new Error("do not store passwords in Intake config; use password_env or keychain");
  const type = input.type || existing?.type || "manual";
  const config = { ...(existing?.config || {}) };

  if (type === "email") {
    config.username = input.username ?? config.username ?? "";
    config.from = input.from ?? config.from ?? config.username;
    config.mailbox = input.mailbox ?? config.mailbox ?? "INBOX";
    config.imap = {
      host: input.imap_host ?? input.imapHost ?? config.imap?.host ?? "mail.privateemail.com",
      port: Number(input.imap_port ?? input.imapPort ?? config.imap?.port ?? 993),
      secure: input.insecure ? false : true
    };
    config.smtp = {
      host: input.smtp_host ?? input.smtpHost ?? config.smtp?.host ?? "mail.privateemail.com",
      port: Number(input.smtp_port ?? input.smtpPort ?? config.smtp?.port ?? 465),
      secure: input.insecure ? false : true
    };
  } else if (type === "file") {
    config.path = input.path ?? config.path ?? "";
  } else if (["webhook", "github", "jira", "linear", "clickup"].includes(type)) {
    config.port = Number(input.port ?? config.port ?? 8765);
    config.path = input.path ?? config.path ?? "";
    if (input.token) config.token = input.token;
    const apiTokenRef = input.api_token_ref || input.apiTokenRef || (input.api_token_env || input.apiTokenEnv ? `env:${input.api_token_env || input.apiTokenEnv}` : null);
    if (apiTokenRef) {
      validateSecretRef(apiTokenRef, input.id || existing?.id || type);
      config.api_token_ref = apiTokenRef;
    }
    if (input.repository) config.repository = input.repository;
  } else if (type === "slack") {
    config.port = Number(input.port ?? config.port ?? 8766);
    config.path = input.path ?? config.path ?? "";
    config.workspace_url = input.workspace_url ?? input.workspaceUrl ?? config.workspace_url ?? "";
  }
  if (input.quarantine_attachments !== undefined || input.quarantineAttachments !== undefined) {
    config.quarantine_attachments = Boolean(input.quarantine_attachments ?? input.quarantineAttachments);
  }
  const allowedActions = input.allowed_actions ?? input.allowedActions;
  if (allowedActions) config.allowed_actions = Array.isArray(allowedActions) ? allowedActions : String(allowedActions).split(",").map((part) => part.trim()).filter(Boolean);

  const secret_ref = sourceSecretRef(input, existing);
  if (secret_ref) validateSecretRef(secret_ref, input.id || existing?.id || type);

  return makeSource(type, {
    id: sourceId(input.id || existing?.id),
    name: input.name || existing?.name || type,
    enabled: input.enabled ?? existing?.enabled ?? true,
    config,
    secret_ref,
    default_queue: input.default_queue || input.defaultQueue || input.queue || existing?.default_queue || "inbox",
    sync_mode: input.sync_mode || input.syncMode || existing?.sync_mode || "manual",
    poll_interval_minutes: Number(input.poll_interval_minutes || input.pollIntervalMinutes || existing?.poll_interval_minutes || 15),
    auto_action_policy: input.auto_action_policy || input.autoActionPolicy || existing?.auto_action_policy || "default-safe-human-gate",
    cursor: existing?.cursor || null,
    capabilities: capabilitiesFor(type),
    created_at: existing?.created_at
  });
}

function sourceId(id) {
  return id ? assertSafeId(id, "source id") : id;
}

export function sanitizeSources(sources) {
  return sources.map(sanitizeSource);
}

export function sanitizeSource(source) {
  const config = { ...(source.config || {}) };
  if (config.token) config.token = "[REDACTED]";
  if (config.api_token) config.api_token = "[REDACTED]";
  return { ...source, config };
}

function sourceSecretRef(input, existing = null) {
  if (input.secret || input.secret_ref || input.secretRef) {
    return input.secret || input.secret_ref || input.secretRef;
  }
  const keychainService = input.keychain_service || input.keychainService;
  const keychainAccount = input.keychain_account || input.keychainAccount;
  const secretKind = input.secret_kind || input.secretKind;
  if (secretKind === "keychain" || (!secretKind && (keychainService || keychainAccount))) {
    if (!keychainService || !keychainAccount) {
      throw new Error("keychain secrets require keychain_service and keychain_account");
    }
    return `keychain:${keychainService}:${keychainAccount}`;
  }
  const passwordEnv = input.password_env || input.passwordEnv;
  if (passwordEnv) return `env:${passwordEnv}`;
  return existing?.secret_ref || null;
}

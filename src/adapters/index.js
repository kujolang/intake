import { syncEmailSource, testEmailConnection, validateEmailConfig, emailCapabilities, sendEmailResponse, appendEmailDraft } from "./email.js";
import { syncFileSource, fileCapabilities } from "./file.js";
import { manualCapabilities } from "./manual.js";
import { isIssueSourceType, issueCapabilities, testIssueConnection, validateIssueConfig } from "./issues.js";
import { slackCapabilities, testSlackConnection, validateSlackConfig } from "./slack.js";
import { webhookCapabilities } from "./webhook.js";

export function capabilitiesFor(type) {
  if (type === "email") return emailCapabilities();
  if (type === "file") return fileCapabilities();
  if (type === "manual") return manualCapabilities();
  if (type === "webhook") return webhookCapabilities();
  if (type === "slack") return slackCapabilities();
  if (isIssueSourceType(type)) return issueCapabilities(type);
  return [];
}

export async function syncSource(root, source) {
  if (source.type === "email") return syncEmailSource(root, source);
  if (source.type === "file") return syncFileSource(root, source);
  if (source.type === "manual") return { items: [], cursor: source.cursor || null };
  if (source.type === "webhook") return { items: [], cursor: source.cursor || null };
  if (isIssueSourceType(source.type)) return { items: [], cursor: source.cursor || null };
  throw new Error(`unsupported source type: ${source.type}`);
}

export async function testSource(source) {
  if (source.type === "email") return testEmailConnection(source);
  if (source.type === "file") {
    return source.config?.path ? { ok: true } : { ok: false, errors: ["missing config.path"] };
  }
  if (source.type === "webhook") {
    return source.secret_ref || source.config?.token ? { ok: true } : { ok: false, errors: ["missing token or secret_ref"] };
  }
  if (source.type === "slack") return testSlackConnection(source);
  if (isIssueSourceType(source.type)) return testIssueConnection(source);
  if (source.type === "manual") return { ok: true };
  return { ok: false, errors: [`unsupported source type: ${source.type}`] };
}

export function validateSourceConfig(source) {
  if (source.type === "email") return validateEmailConfig(source);
  if (source.type === "file" && !source.config?.path) return ["missing file drop path"];
  if (source.type === "webhook" && !source.secret_ref && !source.config?.token) return ["missing webhook token or secret_ref"];
  if (source.type === "slack") return validateSlackConfig(source);
  if (isIssueSourceType(source.type)) return validateIssueConfig(source);
  return [];
}

export async function executeAdapterAction(source, action, item) {
  if (source.type === "email" && action.type === "send_response") return sendEmailResponse(source, action, item);
  if (source.type === "email" && action.type === "append_remote_draft") return appendEmailDraft(source, action, item);
  throw new Error(`source ${source.id} does not support action ${action.type}`);
}

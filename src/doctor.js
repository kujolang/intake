import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { REQUIRED_DIRS, STORAGE_SCHEMA_VERSION } from "./constants.js";
import { validateSourceConfig } from "./adapters/index.js";
import { resolveSecretRef } from "./secrets.js";
import { loadMeta, loadPolicies, loadRules, loadSettings, loadSources, logEvent } from "./storage.js";

export async function runDoctor(root) {
  const checks = [];
  await checkFolders(root, checks);
  await checkConfigs(root, checks);
  await checkLogs(root, checks);
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  await logEvent(root, failed.length ? "errors" : "audit", {
    event_type: "doctor",
    status: failed.length ? "failed" : "ok",
    error: failed.map((check) => `${check.id}: ${check.message}`).join("; ") || null,
    warnings: warnings.map((check) => `${check.id}: ${check.message}`)
  });
  return { ok: failed.length === 0, failed: failed.length, warnings: warnings.length, checks };
}

async function checkFolders(root, checks) {
  for (const dir of REQUIRED_DIRS) {
    try {
      await mkdir(join(root, dir), { recursive: true });
      checks.push({ id: `folder:${dir}`, status: "ok", message: "present" });
    } catch (error) {
      checks.push({ id: `folder:${dir}`, status: "fail", message: error.message });
    }
  }
}

async function checkConfigs(root, checks) {
  const sources = await loadSources(root);
  const settings = await loadSettings(root);
  const meta = await loadMeta(root);
  const policies = await loadPolicies(root);
  const rules = await loadRules(root);
  checks.push({
    id: "storage:schema",
    status: meta.schema_version === STORAGE_SCHEMA_VERSION ? "ok" : "fail",
    message: `schema ${meta.schema_version || "unknown"}${meta.schema_version === STORAGE_SCHEMA_VERSION ? "" : ` expected ${STORAGE_SCHEMA_VERSION}`}`
  });
  checks.push({ id: "settings:auto-actions", status: settings.auto_actions_enabled ? "warn" : "ok", message: settings.auto_actions_enabled ? "global auto-actions enabled" : "global auto-actions disabled" });
  checks.push({ id: "policies:present", status: policies.length ? "ok" : "fail", message: `${policies.length} policies` });
  checks.push({ id: "rules:present", status: rules.length ? "ok" : "fail", message: `${rules.length} rules` });
  for (const source of sources) {
    const errors = validateSourceConfig(source);
    const sourceStatus = errors.length ? sourceSeverity(source) : "ok";
    checks.push({
      id: `source:${source.id}`,
      status: sourceStatus,
      message: errors.length ? `${errors.join("; ")}${source.enabled ? "" : " (disabled source)"}` : `${source.type} configured`
    });
    checkSecretRef(source, checks);
  }
}

function sourceSeverity(source) {
  return source.enabled ? "fail" : "warn";
}

function checkSecretRef(source, checks) {
  if (!source.secret_ref) {
    if (source.type === "email") {
      checks.push({
        id: `secret:${source.id}`,
        status: sourceSeverity(source),
        message: `missing secret_ref${source.enabled ? "" : " (disabled source)"}`
      });
    }
    return;
  }
  try {
    resolveSecretRef(source.secret_ref, source.id);
    checks.push({ id: `secret:${source.id}`, status: "ok", message: `${secretRefLabel(source.secret_ref)} reachable` });
  } catch (error) {
    checks.push({
      id: `secret:${source.id}`,
      status: sourceSeverity(source),
      message: `${error.message}${source.enabled ? "" : " (disabled source)"}`
    });
  }
}

function secretRefLabel(secretRef) {
  if (secretRef.startsWith("env:")) return `env ${secretRef.slice(4)}`;
  if (secretRef.startsWith("keychain:")) {
    const [, service, account] = secretRef.split(":");
    return `keychain ${service}/${account}`;
  }
  return "secret_ref";
}

async function checkLogs(root, checks) {
  const audit = join(root, "logs", "audit.jsonl");
  try {
    await access(audit);
    const sample = await readFile(audit, "utf8");
    checks.push({
      id: "logs:redaction",
      status: /password|secret|token/i.test(sample) && !sample.includes("[REDACTED]") ? "warn" : "ok",
      message: "audit log readable"
    });
  } catch (error) {
    checks.push({ id: "logs:audit", status: "fail", message: error.message });
  }
}

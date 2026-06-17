import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadDotEnvFiles({ cwd = process.cwd(), intakeDir = process.env.INTAKE_DIR || ".intake" } = {}) {
  for (const path of [join(cwd, ".env"), join(cwd, intakeDir, ".env")]) {
    if (existsSync(path)) loadDotEnvFile(path);
  }
}

export function loadDotEnvFile(path) {
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function resolveSecretRef(secretRef, sourceId = "source") {
  validateSecretRef(secretRef, sourceId);
  if (secretRef.startsWith("env:")) {
    const name = secretRef.slice(4);
    const value = process.env[name];
    if (!value) throw new Error(`missing secret env var ${name}`);
    return value;
  }
  if (secretRef.startsWith("keychain:")) {
    const [, service, account] = secretRef.split(":");
    if (!service || !account) throw new Error(`invalid keychain secret_ref for ${sourceId}`);
    return readMacKeychainSecret(service, account);
  }
  throw new Error(`unsupported secret_ref for ${sourceId}: use env:NAME or keychain:SERVICE:ACCOUNT`);
}

export function validateSecretRef(secretRef, sourceId = "source") {
  if (!secretRef) throw new Error(`source ${sourceId} must define a secret_ref`);
  if (secretRef.startsWith("env:")) {
    const name = secretRef.slice(4);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid env secret_ref for ${sourceId}`);
    return true;
  }
  if (secretRef.startsWith("keychain:")) {
    const [, service, account] = secretRef.split(":");
    if (!service || !account) throw new Error(`invalid keychain secret_ref for ${sourceId}`);
    return true;
  }
  throw new Error(`unsupported secret_ref for ${sourceId}: use env:NAME or keychain:SERVICE:ACCOUNT`);
}

function readMacKeychainSecret(service, account) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    throw new Error(`missing macOS Keychain secret service=${service} account=${account}`);
  }
}

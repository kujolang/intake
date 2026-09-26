import { randomUUID } from "node:crypto";
import { createGunzip, createGzip } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { STORAGE_SCHEMA_VERSION, VERSION } from "./constants.js";
import { initStore, loadMeta, logEvent } from "./storage.js";
import { isoNow, sha256 } from "./util.js";

const BACKUP_FORMAT = "kujo-intake-backup";
const BACKUP_FORMAT_VERSION = 1;
const DEFAULT_MAX_BACKUP_BYTES = 256 * 1024 * 1024;

export async function createBackup(root, options = {}) {
  await initStore(root);
  const output = options.output || defaultBackupPath(root);
  const files = await collectFiles(root, { includeSecrets: options.includeSecrets === true });
  const meta = await loadMeta(root);
  const backup = {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    app_version: VERSION,
    schema_version: meta.schema_version || STORAGE_SCHEMA_VERSION,
    created_at: isoNow(),
    include_secrets: options.includeSecrets === true,
    files
  };
  await mkdir(dirname(output), { recursive: true });
  await writeGzipJson(output, backup);
  const rotation = options.keep ? await rotateBackups(dirname(output), Number(options.keep)) : { removed: [] };
  await logEvent(root, "audit", {
    event_type: "backup_created",
    status: "ok",
    output_refs: [output],
    metadata: { file_count: files.length, include_secrets: backup.include_secrets, rotated: rotation.removed.length }
  });
  return { ...backupSummary(backup, output), rotation };
}

export async function verifyBackup(path, options = {}) {
  const backup = await readGzipJson(path, options);
  const errors = validateBackup(backup);
  return {
    ok: errors.length === 0,
    path,
    errors,
    file_count: Array.isArray(backup?.files) ? backup.files.length : 0,
    schema_version: backup?.schema_version,
    created_at: backup?.created_at,
    include_secrets: backup?.include_secrets === true
  };
}

export async function restoreBackup(path, targetRoot, options = {}) {
  // Validate the same in-memory archive that will be restored, before touching target.
  const backup = await readGzipJson(path, options);
  const errors = validateBackup(backup);
  if (errors.length) throw new Error(`backup verification failed: ${errors.join("; ")}`);
  await assertRestoreTarget(targetRoot, options.force === true);
  const staging = `${resolve(targetRoot)}.restore-${randomUUID()}`;
  const previous = `${resolve(targetRoot)}.previous-${randomUUID()}`;
  let movedPrevious = false;
  let committed = false;
  try {
    await mkdir(staging, { recursive: true });
    for (const file of backup.files) {
      const target = safeJoin(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content_base64, "base64"), { flag: "wx" });
    }
    await initStore(staging);
    await logEvent(staging, "audit", {
      event_type: "backup_restored",
      status: "ok",
      input_refs: [path],
      metadata: { file_count: backup.files.length, source_created_at: backup.created_at }
    });
    // Recheck because building the staging tree may take time.
    await assertRestoreTarget(targetRoot, options.force === true);
    try {
      await rename(targetRoot, previous);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, targetRoot);
      committed = true;
    } catch (error) {
      if (movedPrevious) await rename(previous, targetRoot);
      throw error;
    }
    if (movedPrevious) await rm(previous, { recursive: true, force: true });
    return { ok: true, path, restored_to: targetRoot, file_count: backup.files.length };
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true });
  }
}

async function collectFiles(root, options) {
  const rootPath = resolve(root);
  const out = [];
  await walk(rootPath, rootPath, out, options);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(rootPath, dir, out, options) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(rootPath, abs);
    if (shouldSkip(rel, entry, options)) continue;
    if (entry.isDirectory()) {
      await walk(rootPath, abs, out, options);
      continue;
    }
    if (!entry.isFile()) continue;
    let buffer = await readFile(abs);
    if (!options.includeSecrets && rel === join("config", "sources.json")) {
      const sources = JSON.parse(buffer.toString("utf8"));
      for (const source of sources) {
        for (const key of ["token", "api_token", "signing_secret"]) delete source.config?.[key];
      }
      buffer = Buffer.from(`${JSON.stringify(sources, null, 2)}\n`);
    }
    out.push({
      path: rel,
      size: buffer.length,
      sha256: sha256(buffer),
      content_base64: buffer.toString("base64")
    });
  }
}

function shouldSkip(rel, entry, options) {
  const parts = rel.split(sep);
  if (parts[0] === "backups" || parts[0] === ".action-lock" || /\.tmp-/.test(entry.name)) return true;
  if (entry.name === ".DS_Store") return true;
  if (entry.name === ".env" && options.includeSecrets !== true) return true;
  if (parts[0] === "secrets" && options.includeSecrets !== true) return true;
  return false;
}

function validateBackup(backup) {
  const errors = [];
  if (backup?.format !== BACKUP_FORMAT) errors.push("unsupported backup format");
  if (backup?.format_version !== BACKUP_FORMAT_VERSION) errors.push("unsupported backup format version");
  if (backup?.schema_version !== STORAGE_SCHEMA_VERSION) errors.push(`unsupported schema version ${backup?.schema_version}`);
  if (!Array.isArray(backup?.files)) return [...errors, "missing files array"];
  const paths = new Set();
  for (const file of backup.files) {
    if (!file || typeof file.path !== "string" || !file.path || file.path.includes("\0") || /^[A-Za-z]:/.test(file.path) || file.path.includes("\\") || file.path.split("/").some((part) => !part || part === "." || part === "..")) {
      errors.push("unsafe backup path");
      continue;
    }
    if (paths.has(file.path)) errors.push(`duplicate backup path ${file.path}`);
    paths.add(file.path);
    if (typeof file.content_base64 !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) {
      errors.push(`invalid file record ${file.path}`);
      continue;
    }
    const buffer = Buffer.from(file.content_base64, "base64");
    if (buffer.toString("base64") !== file.content_base64) errors.push(`invalid base64 ${file.path}`);
    if (buffer.length !== file.size) errors.push(`size mismatch ${file.path}`);
    if (sha256(buffer) !== file.sha256) errors.push(`checksum mismatch ${file.path}`);
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join("/"))) errors.push(`conflicting backup path ${path}`);
    }
  }
  return errors;
}

async function assertRestoreTarget(targetRoot, force) {
  let entries = [];
  try {
    entries = await readdir(targetRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!force && entries.length > 0) {
    throw new Error(`restore target is not empty: ${targetRoot}; pass --force to replace it`);
  }
}

function safeJoin(root, relPath) {
  const rootPath = resolve(root);
  const target = resolve(rootPath, relPath);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`unsafe restore path: ${relPath}`);
  }
  return target;
}

function backupSummary(backup, output) {
  return {
    ok: true,
    path: output,
    file_count: backup.files.length,
    schema_version: backup?.schema_version,
    created_at: backup?.created_at,
    include_secrets: backup.include_secrets
  };
}

function defaultBackupPath(root) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return join(root, "backups", `intake-backup-${stamp}.json.gz`);
}

async function rotateBackups(dir, keep) {
  if (!Number.isFinite(keep) || keep < 1) throw new Error("--keep must be a positive number");
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { removed: [] };
  }
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json.gz")) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    backups.push({ path, mtimeMs: info.mtimeMs });
  }
  backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed = [];
  for (const backup of backups.slice(keep)) {
    await rm(backup.path, { force: true });
    removed.push(basename(backup.path));
  }
  return { kept: Math.min(backups.length, keep), removed };
}

async function writeGzipJson(path, value) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await pipeline(Readable.from([`${JSON.stringify(value, null, 2)}\n`]), createGzip({ level: 9 }), createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function readGzipJson(path, options = {}) {
  const maxBytes = Number(options.maxBytes ?? DEFAULT_MAX_BACKUP_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("backup size limit must be a positive integer");
  const chunks = [];
  let bytes = 0;
  await pipeline(
    createReadStream(path),
    createGunzip(),
    new Writable({
      write(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(new Error(`backup exceeds decompressed limit of ${maxBytes} bytes`));
        chunks.push(chunk);
        callback();
      }
    })
  );
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

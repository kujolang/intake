import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function isoNow() {
  return new Date().toISOString();
}

export function dateOnly(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function sha256(text) {
  return createHash("sha256").update(Buffer.isBuffer(text) ? text : String(text)).digest("hex");
}

export function shortHash(text, len = 12) {
  return sha256(text).slice(0, len);
}

export function newId(prefix, seed = randomUUID()) {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}_${now}_${shortHash(seed, 10)}`;
}

export function slug(text, fallback = "item") {
  const out = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

export function assertSafeId(value, label = "id") {
  const text = String(value || "");
  if (!SAFE_ID.test(text)) {
    throw new Error(`invalid ${label}: use 1-128 letters, numbers, dots, underscores, colons, or dashes`);
  }
  return text;
}

export function includesAny(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

export async function readStreamText(stream, { maxBytes = 1024 * 1024, label = "request body" } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error(`${label} exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export function timingSafeEqualString(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  const length = Math.max(actualBuffer.length, expectedBuffer.length, 1);
  const actualPadded = Buffer.alloc(length);
  const expectedPadded = Buffer.alloc(length);
  actualBuffer.copy(actualPadded);
  expectedBuffer.copy(expectedPadded);
  return timingSafeEqual(actualPadded, expectedPadded) && actualBuffer.length === expectedBuffer.length;
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw new Error(`cannot read JSON ${path}: ${error.message}`);
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function writeTextAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, value, "utf8");
  await rename(tmp, path);
}

export function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

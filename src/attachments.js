import { withStoreLock } from "./store-lock.js";
import { constants } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { assertSafeId, shortHash } from "./util.js";
import { readBounded, resourceLimit } from "./resource-limits.js";

const MAX_ATTACHMENT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export async function attachmentMetadata(root, source, itemId, attachments = []) {
  return withStoreLock(root, () => attachmentMetadataLocked(root, source, itemId, attachments));
}

async function attachmentMetadataLocked(root, source, itemId, attachments = []) {
  const quarantine = source.config?.quarantine_attachments === true || source.config?.attachment_quarantine === true;
  const rows = [];
  for (const attachment of attachments) {
    const base = {
      filename: attachment.filename || "attachment",
      content_type: attachment.contentType || attachment.content_type || "application/octet-stream",
      size: attachment.size || attachment.content?.length || 0,
      checksum: attachment.checksum || shortHash(attachment.content || `${attachment.filename}:${attachment.size}`, 32)
    };
    if (!quarantine || !attachment.content) {
      rows.push(base);
      continue;
    }
    const extension = safeExtension(base.filename);
    const safeItem = assertSafeId(itemId, "item id");
    const safeSource = assertSafeId(source.id, "source id");
    const fileName = `${safeItem}-${shortHash(`${base.filename}:${base.checksum}`, 16)}.${extension}`;
    const target = join(root, "raw", "attachments", safeSource, fileName);
    await mkdir(join(root, "raw", "attachments", safeSource), { recursive: true });
    await writeFile(target, attachment.content);
    rows.push({ ...base, quarantined: true, quarantine_path: relative(root, target) });
  }
  return rows;
}

export function attachmentInventory(item) {
  return (item.attachments || []).map((attachment, index) => ({
    index,
    filename: attachment.filename || "attachment",
    content_type: attachment.content_type || attachment.contentType || "application/octet-stream",
    size: Number(attachment.size || 0),
    checksum: attachment.checksum || null,
    quarantined: attachment.quarantined === true,
    downloadable: attachment.quarantined === true && Boolean(attachment.quarantine_path)
  }));
}

export async function readQuarantinedAttachment(root, item, index, options = {}) {
  return withStoreLock(root, () => readQuarantinedAttachmentLocked(root, item, index, options));
}

async function readQuarantinedAttachmentLocked(root, item, index, options = {}) {
  const selectedIndex = Number(index);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) throw new Error("attachment index must be a non-negative integer");
  const attachment = (item.attachments || [])[selectedIndex];
  if (!attachment) throw new Error("attachment not found");
  if (attachment.quarantined !== true || !attachment.quarantine_path) throw new Error("attachment is not quarantined");

  const rootPath = resolve(root);
  const quarantineRoot = resolve(rootPath, "raw", "attachments");
  const target = resolve(rootPath, String(attachment.quarantine_path));
  if (!target.startsWith(`${quarantineRoot}${sep}`)) throw new Error("unsafe attachment quarantine path");

  const canonicalRoot = await realpath(rootPath);
  const canonicalTarget = await realpath(target);
  if (!canonicalTarget.startsWith(`${join(canonicalRoot, "raw", "attachments")}${sep}`)) throw new Error("unsafe attachment quarantine path");
  const maxBytes = resourceLimit(options.maxBytes, MAX_ATTACHMENT_DOWNLOAD_BYTES, "attachment download size limit");
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let content;
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("attachment quarantine target is not a file");
    if (info.size > maxBytes) throw new Error(`attachment exceeds download limit of ${maxBytes} bytes`);
    content = await readBounded(file.createReadStream({ autoClose: false }), maxBytes, "attachment");
  } finally {
    await file.close();
  }
  return {
    ...attachmentInventory({ attachments: [attachment] })[0],
    item_id: item.id,
    content_base64: content.toString("base64")
  };
}

function safeExtension(filename) {
  const ext = extname(basename(filename || "")).replace(/^\./, "").toLowerCase() || "bin";
  return assertSafeId(ext.replace(/[^a-z0-9_-]/g, "") || "bin", "attachment extension");
}

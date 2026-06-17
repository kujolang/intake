import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { assertSafeId, shortHash } from "./util.js";

export async function attachmentMetadata(root, source, itemId, attachments = []) {
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

function safeExtension(filename) {
  const ext = extname(basename(filename || "")).replace(/^\./, "").toLowerCase() || "bin";
  return assertSafeId(ext.replace(/[^a-z0-9_-]/g, "") || "bin", "attachment extension");
}

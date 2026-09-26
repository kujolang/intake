import { open } from "node:fs/promises";

// Read from the tail so a small page does not parse or retain the entire audit log.
export async function readLogPage(path, { limit = 200, offset = 0 } = {}) {
  limit = Number(limit);
  offset = Number(offset);
  if (Number.isNaN(limit) || !Number.isFinite(offset)) return [];
  limit = Math.max(0, Math.trunc(limit));
  offset = Math.max(0, Math.trunc(offset));
  if (!limit) return [];
  let file;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    let position = (await file.stat()).size;
    let remainder = Buffer.alloc(0);
    const rows = [];
    let skipped = 0;
    const accept = (buffer) => {
      const line = buffer.toString("utf8").replace(/\r$/, "");
      if (!line) return;
      if (skipped++ < offset) return;
      try {
        rows.push(JSON.parse(line));
      } catch {
        rows.push({ parse_error: true, line });
      }
    };
    while (position > 0 && rows.length < limit) {
      const size = Math.min(position, 64 * 1024);
      position -= size;
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await file.read(chunk, 0, size, position);
      const data = Buffer.concat([chunk.subarray(0, bytesRead), remainder]);
      let end = data.length;
      for (let index = data.length - 1; index >= 0 && rows.length < limit; index--) {
        if (data[index] !== 10) continue;
        accept(data.subarray(index + 1, end));
        end = index;
      }
      remainder = Buffer.from(data.subarray(0, end));
    }
    if (position === 0 && rows.length < limit) accept(remainder);
    return rows;
  } finally {
    await file.close();
  }
}

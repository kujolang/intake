export function resourceLimit(value, fallback, name) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2147483647) throw new Error(`${name} must be a positive integer no greater than 2147483647`);
  return limit;
}

export async function readBounded(stream, maxBytes, label) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error(`${label} byte limit must be a non-negative safe integer`);
  const chunks = [];
  let size = 0;
  let block;
  let used = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length > maxBytes - size) {
      const error = new Error(`${label} exceeds ${maxBytes} bytes`);
      error.code = "INTAKE_RESOURCE_LIMIT";
      throw error;
    }
    // Bound retained metadata by bytes, not by attacker-controlled chunk count.
    let offset = 0;
    while (offset < buffer.length) {
      if (!block || used === block.length) {
        block = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size));
        chunks.push(block);
        used = 0;
      }
      const length = Math.min(buffer.length - offset, block.length - used);
      buffer.copy(block, used, offset, offset + length);
      offset += length;
      used += length;
      size += length;
    }
  }
  return Buffer.concat(chunks, size);
}

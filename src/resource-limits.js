export function resourceLimit(value, fallback, name) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 2147483647) throw new Error(`${name} must be a positive integer no greater than 2147483647`);
  return limit;
}

export async function readBounded(stream, maxBytes, label) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

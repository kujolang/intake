import assert from "node:assert/strict";

export function assertIntakeItemContract(item, source) {
  assert.equal(item.source_id, source.id);
  assert.equal(item.source_type, source.type);
  assert.ok(item.id, "item has an id");
  assert.ok(item.title, "item has a title");
  assert.ok(item.normalized_text, "item has normalized text");
  assert.ok(item.dedupe_key.startsWith(`${source.id}:`), "item dedupe key is scoped to source");
  assert.ok(item.raw_payload_path, "item has a raw payload path");
  assert.ok(Array.isArray(item.tags), "item tags are an array");
}

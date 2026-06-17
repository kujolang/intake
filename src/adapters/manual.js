import { makeItem } from "../models.js";
import { storeRaw } from "../storage.js";
import { isoNow, stableStringify } from "../util.js";

export function manualCapabilities() {
  return ["create_item"];
}

export async function createManualItem(root, source, input) {
  const raw = {
    type: "manual",
    title: input.title,
    body: input.body,
    author: input.author || "local-operator",
    created_at: isoNow()
  };
  const seed = stableStringify(raw);
  const temp = makeItem({
    source_id: source.id,
    source_type: "manual",
    source_native_id: input.native_id || null,
    title: input.title,
    body: input.body,
    author: input.author || "local-operator",
    queue: input.queue || source.default_queue || "inbox",
    tags: input.tags || [],
    received_at: isoNow(),
    metadata: { manual: true }
  });
  const rawPath = await storeRaw(root, "manual", source.id, temp.id, "json", seed);
  return { ...temp, raw_payload_path: rawPath };
}

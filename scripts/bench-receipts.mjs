import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initStore, listItems } from "../src/storage.js";
import { makeSource } from "../src/models.js";
import { startWebhookServer } from "../src/adapters/webhook.js";
import { readLogPage } from "../src/logs.js";

// Deterministic work counts, not a latency benchmark. No outbound provider calls.
const root = await mkdtemp(join(tmpdir(), "intake-receipt-bench-"));
let receiver;
try {
  await initStore(root);
  receiver = await startWebhookServer(root, makeSource("webhook", { id: "bench", config: { token: "fixture" } }), { port: 0 });
  const deliveries = 12;
  const ids = new Set();
  for (let i = 0; i < deliveries; i++) {
    const response = await fetch(receiver.url, { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ id: "one", title: "Help", body: "A support question" }) });
    if (response.status !== 202) throw new Error(`delivery failed: ${response.status}`);
    ids.add((await response.json()).item_id);
  }
  console.log(JSON.stringify({ deliveries, distinct_response_ids: ids.size, persisted_items: (await listItems(root)).length, classifications: (await readLogPage(join(root, "logs", "classify.jsonl"))).length }, null, 2));
} finally {
  if (receiver) await new Promise((resolve) => receiver.server.close(resolve));
  await rm(root, { recursive: true, force: true });
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWebhookServer } from "../src/adapters/webhook.js";
import { makeSource } from "../src/models.js";
import { initStore } from "../src/storage.js";

async function withWebhook(fn) {
  const root = await mkdtemp(join(tmpdir(), "intake-webhook-test-"));
  let server;
  try {
    await initStore(root);
    const source = makeSource("webhook", {
      id: "events",
      name: "Events",
      config: { path: "/hook", token: "secret-token" }
    });
    const started = await startWebhookServer(root, source, { port: 0 });
    server = started.server;
    return await fn(started);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test("webhook rejects bad tokens and oversized bodies", async () => {
  await withWebhook(async ({ url }) => {
    const unauthorized = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: JSON.stringify({ title: "Nope" })
    });
    assert.equal(unauthorized.status, 401);

    const oversized = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" },
      body: "x".repeat(1024 * 1024 + 1)
    });
    assert.equal(oversized.status, 413);
  });
});

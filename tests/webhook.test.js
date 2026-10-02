import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
    return await fn(started, root);
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

test("webhook returns the primary store error when error logging is unavailable", async () => {
  await withWebhook(async ({ url }, root) => {
    const lock = `${await realpath(root)}.intake-lock`;
    await writeFile(lock, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
        body: JSON.stringify({ title: "Busy store" })
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "store is locked by another operation; retry after it completes or run intake store recover after the owner exits",
        error_log: "unavailable"
      });
    } finally {
      await rm(lock, { force: true });
    }
  });
});

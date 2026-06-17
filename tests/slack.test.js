import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signSlackTestBody, startSlackServer } from "../src/adapters/slack.js";
import { makeSource } from "../src/models.js";
import { initStore, listItems } from "../src/storage.js";

async function withSlack(fn) {
  const root = await mkdtemp(join(tmpdir(), "intake-slack-test-"));
  let server;
  try {
    await initStore(root);
    const source = makeSource("slack", {
      id: "slack-support",
      name: "Slack Support",
      config: { path: "/slack/events", signing_secret: "slack-secret", workspace_url: "https://example.slack.com" },
      default_queue: "engineering"
    });
    const started = await startSlackServer(root, source, { port: 0 });
    server = started.server;
    return await fn(started, root);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test("Slack receiver verifies signed events and normalizes messages", async () => {
  await withSlack(async ({ url }, root) => {
    const bad = await fetch(url, { method: "POST", body: JSON.stringify({ type: "event_callback" }) });
    assert.equal(bad.status, 401);

    const challengeBody = JSON.stringify({ type: "url_verification", challenge: "challenge-token" });
    const challengeSig = signSlackTestBody(challengeBody, "slack-secret");
    const challenge = await fetch(url, {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": challengeSig.timestamp,
        "x-slack-signature": challengeSig.signature
      },
      body: challengeBody
    });
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "challenge-token");

    const eventBody = JSON.stringify({
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev123",
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "The release is broken with an error",
        ts: "1781650000.000100"
      }
    });
    const eventSig = signSlackTestBody(eventBody, "slack-secret");
    const event = await fetch(url, {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": eventSig.timestamp,
        "x-slack-signature": eventSig.signature
      },
      body: eventBody
    });
    assert.equal(event.status, 202);
    const items = await listItems(root);
    assert.equal(items.length, 1);
    assert.equal(items[0].source_type, "slack");
    assert.equal(items[0].queue, "engineering");
    assert.ok(items[0].tags.includes("slack"));
    assert.ok(items[0].tags.includes("bug-report"));
  });
});

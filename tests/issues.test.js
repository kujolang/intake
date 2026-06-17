import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addGitHubIssueComment, normalizeIssuePayload, signGitHubBody, startIssueWebhookServer, testIssueConnection } from "../src/adapters/issues.js";
import { makeAction, makeItem, makeSource } from "../src/models.js";
import { initStore, listItems, saveSources } from "../src/storage.js";
import { assertIntakeItemContract } from "./adapter-contract.js";

async function withStore(fn) {
  const root = await mkdtemp(join(tmpdir(), "intake-issues-test-"));
  try {
    await initStore(root);
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("GitHub webhook payloads normalize into intake items", async () => {
  await withStore(async (root) => {
    const source = makeSource("github", { id: "github", name: "GitHub", secret_ref: "env:INTAKE_GITHUB_TOKEN" });
    const item = await normalizeIssuePayload(root, source, {
      action: "opened",
      repository: { full_name: "acme/app" },
      issue: {
        id: 123,
        number: 7,
        title: "Checkout regression",
        body: "The checkout flow crashes with a token error.",
        html_url: "https://github.com/acme/app/issues/7",
        state: "open",
        user: { login: "octocat" },
        created_at: "2026-06-16T10:00:00.000Z"
      }
    });
    assertIntakeItemContract(item, source);
    assert.equal(item.source_native_id, 123);
    assert.equal(item.metadata.project, "acme/app");
    assert.ok(item.tags.includes("github"));
  });
});

test("Jira webhook payloads normalize into intake items", async () => {
  await withStore(async (root) => {
    const source = makeSource("jira", { id: "jira", name: "Jira", secret_ref: "env:INTAKE_JIRA_TOKEN" });
    const item = await normalizeIssuePayload(root, source, {
      webhookEvent: "jira:issue_created",
      issue: {
        key: "SUP-42",
        self: "https://jira.example.test/rest/api/2/issue/SUP-42",
        fields: {
          summary: "PrivateEmail setup is confusing",
          description: "Customer cannot connect IMAP.",
          status: { name: "To Do" },
          project: { key: "SUP" },
          reporter: { displayName: "Sam Customer", emailAddress: "sam@example.test" }
        }
      }
    });
    assertIntakeItemContract(item, source);
    assert.equal(item.source_native_id, "SUP-42");
    assert.equal(item.author_email, "sam@example.test");
    assert.equal(item.metadata.state, "To Do");
  });
});

test("issue webhook receiver accepts token-authenticated payloads", async () => {
  await withStore(async (root) => {
    const source = makeSource("linear", {
      id: "linear",
      name: "Linear",
      config: { token: "secret", path: "/webhook/linear", port: 0 },
      default_queue: "engineering"
    });
    await saveSources(root, [source]);
    const receiver = await startIssueWebhookServer(root, source, { port: 0 });
    try {
      const response = await fetch(receiver.url, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ action: "create", data: { id: "lin-1", identifier: "ENG-1", title: "Bug", description: "Crash in app" } })
      });
      assert.equal(response.status, 202);
      const items = await listItems(root);
      assert.equal(items.length, 1);
      assert.equal(items[0].source_type, "linear");
    } finally {
      await new Promise((resolve) => receiver.server.close(resolve));
    }
  });
});

test("GitHub issue receiver accepts signed webhook payloads", async () => {
  await withStore(async (root) => {
    const source = makeSource("github", {
      id: "github",
      name: "GitHub",
      config: { token: "github-secret", path: "/webhook/github", port: 0 },
      default_queue: "engineering"
    });
    await saveSources(root, [source]);
    const receiver = await startIssueWebhookServer(root, source, { port: 0 });
    try {
      const body = JSON.stringify({
        action: "opened",
        issue: { id: 10, title: "Signed issue", body: "Webhook signed", user: { login: "octocat" } },
        repository: { full_name: "acme/signed" }
      });
      const response = await fetch(receiver.url, {
        method: "POST",
        headers: { "x-hub-signature-256": signGitHubBody(body, "github-secret"), "content-type": "application/json" },
        body
      });
      assert.equal(response.status, 202);
      const items = await listItems(root);
      assert.equal(items.length, 1);
      assert.equal(items[0].source_type, "github");

      const rejected = await fetch(receiver.url, {
        method: "POST",
        headers: { "x-hub-signature-256": signGitHubBody(body, "wrong-secret"), "content-type": "application/json" },
        body
      });
      assert.equal(rejected.status, 401);
    } finally {
      await new Promise((resolve) => receiver.server.close(resolve));
    }
  });
});

test("GitHub comment writeback validates repository and issue number before fetch", async () => {
  const previousFetch = globalThis.fetch;
  process.env.INTAKE_TEST_GITHUB_API_TOKEN = "github-api-token";
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const source = makeSource("github", {
      id: "github",
      name: "GitHub",
      config: { api_token_ref: "env:INTAKE_TEST_GITHUB_API_TOKEN" }
    });
    const action = makeAction({ intake_item_id: "item", type: "comment_issue", body: "hello" });
    await assert.rejects(() => addGitHubIssueComment(source, action, makeItem({
      source_id: "github",
      source_type: "github",
      source_native_id: "issue-node",
      source_thread_id: "7",
      title: "Bad repo",
      body: "Body",
      metadata: { project: "../bad" }
    })), /owner\/name/);
    await assert.rejects(() => addGitHubIssueComment(source, action, makeItem({
      source_id: "github",
      source_type: "github",
      source_native_id: "issue-node",
      source_thread_id: "abc",
      title: "Bad issue",
      body: "Body",
      metadata: { project: "acme/app" }
    })), /numeric issue number/);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.INTAKE_TEST_GITHUB_API_TOKEN;
  }
});

test("issue source readiness checks require a token or secret ref", () => {
  assert.deepEqual(testIssueConnection(makeSource("clickup", { id: "clickup", name: "ClickUp" })).ok, false);
  assert.deepEqual(testIssueConnection(makeSource("clickup", { id: "clickup", name: "ClickUp", secret_ref: "env:CLICKUP_TOKEN" })).ok, true);
});

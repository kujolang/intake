import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualItem } from "../src/adapters/manual.js";
import { startDashboard } from "../src/dashboard.js";
import { makeSource } from "../src/models.js";
import { initStore, saveItem, saveSources } from "../src/storage.js";
import { classifyAndSave } from "../src/workflow.js";

async function withDashboard(fn) {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-test-"));
  let dashboard;
  try {
    await initStore(root);
    const source = makeSource("manual", { id: "manual", name: "Manual" });
    await saveSources(root, [source]);
    const item = await createManualItem(root, source, {
      title: "Refund and API token",
      body: "Please refund me and reset my API token."
    });
    await saveItem(root, item);
    await classifyAndSave(root, item.id);
    dashboard = await startDashboard(root, { port: 0, token: "test-token" });
    return await fn(dashboard, item);
  } finally {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test("dashboard requires API token", async () => {
  await withDashboard(async (dashboard) => {
    const response = await fetch(`http://${dashboard.host}:${dashboard.port}/api/summary`);
    assert.equal(response.status, 401);
  });
});

test("dashboard refuses non-local binding without explicit TLS configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-bind-test-"));
  try {
    await initStore(root);
    await assert.rejects(() => startDashboard(root, { host: "0.0.0.0", port: 0, token: "test-token" }), /localhost/);
    await assert.rejects(() => startDashboard(root, { host: "0.0.0.0", allowNonLocal: true, port: 0, token: "test-token" }), /tls-cert/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard exposes summary, items, actions, and settings APIs", async () => {
  await withDashboard(async (dashboard, item) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const summary = await (await fetch(`${base}/api/summary`, { headers })).json();
    assert.equal(summary.counts.items, 1);
    assert.equal(summary.counts.high_risk, 1);

    const draft = await (await fetch(`${base}/api/items/${item.id}/draft`, { method: "POST", headers, body: "{}" })).json();
    assert.equal(draft.action.type, "draft_response");

    const approved = await (await fetch(`${base}/api/actions/${draft.action.id}/approve`, { method: "POST", headers, body: "{}" })).json();
    assert.equal(approved.action.status, "approved");

    const settings = await (await fetch(`${base}/api/settings/auto-actions`, { method: "POST", headers, body: JSON.stringify({ enabled: true }) })).json();
    assert.equal(settings.settings.auto_actions_enabled, true);
  });
});

test("dashboard updates runtime settings and policies", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const updated = await (await fetch(`${base}/api/settings/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        auto_actions_enabled: true,
        ai_enabled: true,
        ai_provider: "fixture",
        strata_import_dir: "/tmp/strata",
        totalrecall_export_dir: "/tmp/recall"
      })
    })).json();
    assert.equal(updated.settings.auto_actions_enabled, true);
    assert.equal(updated.settings.ai_enabled, true);
    assert.equal(updated.settings.ai_provider, "fixture");

    const current = await (await fetch(`${base}/api/policies`, { headers })).json();
    const policies = current.policies.map((policy) => policy.id === "default-safe-human-gate" ? {
      ...policy,
      allowed_actions: [...policy.allowed_actions, "mark_resolved"]
    } : policy);
    const saved = await (await fetch(`${base}/api/policies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ policies })
    })).json();
    assert.ok(saved.policies[0].allowed_actions.includes("mark_resolved"));

    const bad = await fetch(`${base}/api/policies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ policies: [{ id: "broken" }] })
    });
    assert.equal(bad.status, 500);
  });
});

test("dashboard manages email sources without storing mailbox passwords", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const create = await (await fetch(`${base}/api/sources`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "email",
        id: "support-email",
        name: "Support Email",
        username: "support@example.com",
        password_env: "INTAKE_SUPPORT_EMAIL_PASSWORD",
        default_queue: "support"
      })
    })).json();
    assert.equal(create.source.id, "support-email");
    assert.equal(create.source.type, "email");
    assert.equal(create.source.secret_ref, "env:INTAKE_SUPPORT_EMAIL_PASSWORD");
    assert.equal(create.source.config.imap.host, "mail.privateemail.com");

    const update = await (await fetch(`${base}/api/sources/support-email/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "email",
        name: "Client Support",
        username: "help@example.com",
        password_env: "INTAKE_HELP_EMAIL_PASSWORD",
        default_queue: "needs-review",
        imap_port: 993,
        smtp_port: 465
      })
    })).json();
    assert.equal(update.source.name, "Client Support");
    assert.equal(update.source.config.username, "help@example.com");
    assert.equal(update.source.secret_ref, "env:INTAKE_HELP_EMAIL_PASSWORD");

    const testResult = await (await fetch(`${base}/api/sources/support-email/test`, {
      method: "POST",
      headers,
      body: "{}"
    })).json();
    assert.equal(testResult.result.ok, false);
    assert.match(testResult.result.errors.join(" "), /INTAKE_HELP_EMAIL_PASSWORD/);
    const testedSources = await (await fetch(`${base}/api/sources`, { headers })).json();
    const testedSource = testedSources.sources.find((source) => source.id === "support-email");
    assert.equal(testedSource.last_test_result.ok, false);
    assert.ok(testedSource.last_tested_at);

    const removed = await (await fetch(`${base}/api/sources/support-email/remove`, {
      method: "POST",
      headers,
      body: "{}"
    })).json();
    assert.equal(removed.removed, "support-email");

    const sources = await (await fetch(`${base}/api/sources`, { headers })).json();
    assert.equal(sources.sources.some((source) => source.id === "support-email"), false);
  });
});

test("dashboard supports keychain-backed email source references", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const create = await (await fetch(`${base}/api/sources`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "email",
        id: "billing-email",
        name: "Billing Email",
        username: "billing@example.com",
        secret_kind: "keychain",
        keychain_service: "kujo-intake",
        keychain_account: "billing@example.com",
        default_queue: "billing"
      })
    })).json();
    assert.equal(create.source.secret_ref, "keychain:kujo-intake:billing@example.com");
    assert.equal(create.source.default_queue, "billing");
  });
});

test("dashboard rejects oversized request bodies", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const response = await fetch(`${base}/api/settings/auto-actions`, {
      method: "POST",
      headers,
      body: "x".repeat(1024 * 1024 + 1)
    });
    assert.equal(response.status, 413);
  });
});

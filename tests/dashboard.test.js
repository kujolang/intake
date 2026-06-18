import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualItem } from "../src/adapters/manual.js";
import { startDashboard } from "../src/dashboard.js";
import { makeSource } from "../src/models.js";
import { initStore, listItems, loadItem, loadSources, saveItem, saveSources } from "../src/storage.js";
import { classifyAndSave, syncAll } from "../src/workflow.js";

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
    await assert.rejects(() => startDashboard(root, { host: "0.0.0.0", allowNonLocal: true, port: 0, tlsCert: "cert.pem", tlsKey: "key.pem" }), /requires --token/);
    await assert.rejects(() => startDashboard(root, { host: "0.0.0.0", allowNonLocal: true, port: 0, tlsCert: "cert.pem", tlsKey: "key.pem", token: "short" }), /at least 20 characters/);
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
        ai_provider: "openrouter",
        ai_model: "openai/gpt-4.1-mini",
        ai_base_url: "https://openrouter.ai/api/v1",
        ai_api_key_env: "OPENROUTER_API_KEY",
        strata_import_dir: "/tmp/strata",
        totalrecall_export_dir: "/tmp/recall"
      })
    })).json();
    assert.equal(updated.settings.auto_actions_enabled, true);
    assert.equal(updated.settings.ai_enabled, true);
    assert.equal(updated.settings.ai_provider, "openrouter");
    assert.equal(updated.settings.ai_model, "openai/gpt-4.1-mini");
    assert.equal(updated.settings.ai_base_url, "https://openrouter.ai/api/v1");
    assert.equal(updated.settings.ai_api_key_env, "OPENROUTER_API_KEY");

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

test("dashboard creates and edits actions and rules", async () => {
  await withDashboard(async (dashboard, item) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };

    const createdAction = await (await fetch(`${base}/api/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        item_id: item.id,
        type: "comment_issue",
        risk_level: "medium",
        body: "Initial operator note"
      })
    })).json();
    assert.equal(createdAction.action.type, "comment_issue");
    assert.equal(createdAction.action.proposed_by, "dashboard");

    const updatedAction = await (await fetch(`${base}/api/actions/${createdAction.action.id}/update`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "draft_response",
        risk_level: "low",
        body: "Edited operator note"
      })
    })).json();
    assert.equal(updatedAction.action.type, "draft_response");
    assert.equal(updatedAction.action.body, "Edited operator note");
    assert.equal(updatedAction.action.metadata.edited_by, "dashboard");
    const fetchedAction = await (await fetch(`${base}/api/actions/${createdAction.action.id}`, { headers })).json();
    assert.equal(fetchedAction.action.body, "Edited operator note");

    const createdRule = await (await fetch(`${base}/api/rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "bug-dashboard-test",
        description: "Dashboard-created bug rule",
        match_any: "blank screen, visual bug",
        tags: "bug-report, ui",
        category: "bug",
        intent: "bug_report",
        queue: "engineering",
        risk_level: "medium",
        suggested_actions: "draft_response, check_release_regression"
      })
    })).json();
    assert.equal(createdRule.rule.id, "bug-dashboard-test");
    assert.deepEqual(createdRule.rule.match_any, ["blank screen", "visual bug"]);

    const updatedRule = await (await fetch(`${base}/api/rules/bug-dashboard-test`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        description: "Updated bug rule",
        match_any: ["blank screen"],
        tags: ["bug-report"],
        queue: "release-regression-watch",
        risk_level: "high"
      })
    })).json();
    assert.equal(updatedRule.rule.queue, "release-regression-watch");
    assert.equal(updatedRule.rule.risk_level, "high");

    const badRule = await fetch(`${base}/api/rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "bad rule id", match_any: "broken" })
    });
    assert.equal(badRule.status, 400);
  });
});

test("dashboard bulk resolves selected items", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-bulk-test-"));
  let dashboard;
  try {
    await initStore(root);
    const source = makeSource("manual", { id: "manual", name: "Manual" });
    await saveSources(root, [source]);
    const items = [];
    for (const title of ["First bulk item", "Second bulk item", "Third bulk item"]) {
      const item = await createManualItem(root, source, { title, body: "Bulk dashboard test" });
      await saveItem(root, item);
      items.push(item);
    }
    dashboard = await startDashboard(root, { port: 0, token: "test-token" });
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };

    const resolved = await (await fetch(`${base}/api/items/bulk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "resolve", ids: [items[0].id, items[1].id] })
    })).json();
    assert.equal(resolved.updated_count, 2);
    assert.deepEqual(resolved.item_ids, [items[0].id, items[1].id]);

    const first = await loadItem(root, items[0].id);
    const second = await loadItem(root, items[1].id);
    const third = await loadItem(root, items[2].id);
    assert.equal(first.status, "resolved");
    assert.equal(first.queue, "resolved");
    assert.equal(second.status, "resolved");
    assert.equal(third.status, "new");

    const bad = await fetch(`${base}/api/items/bulk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "block", ids: [items[2].id] })
    });
    assert.equal(bad.status, 400);

    const summary = await (await fetch(`${base}/api/summary`, { headers })).json();
    assert.equal(summary.counts.archived_items, 2);
    assert.equal(summary.counts.active_items, 1);
  } finally {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard items API supports paged list reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-page-test-"));
  let dashboard;
  try {
    await initStore(root);
    const source = makeSource("manual", { id: "manual", name: "Manual" });
    await saveSources(root, [source]);
    for (let index = 0; index < 25; index += 1) {
      const item = await createManualItem(root, source, { title: `Paged item ${index}`, body: "Pagination dashboard test" });
      await saveItem(root, item);
    }
    dashboard = await startDashboard(root, { port: 0, token: "test-token" });
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };

    const first = await (await fetch(`${base}/api/items?limit=20&offset=0`, { headers })).json();
    const second = await (await fetch(`${base}/api/items?limit=20&offset=20`, { headers })).json();
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 5);
    assert.notEqual(first.items[0].id, second.items[0].id);
  } finally {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard previews policy and summarizes approval audit", async () => {
  await withDashboard(async (dashboard, item) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const draft = await (await fetch(`${base}/api/items/${item.id}/draft`, { method: "POST", headers, body: "{}" })).json();
    await fetch(`${base}/api/actions/${draft.action.id}/approve`, { method: "POST", headers, body: "{}" });

    const preview = await (await fetch(`${base}/api/policy/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ item_id: item.id, action_type: "send_response" })
    })).json();
    assert.equal(preview.item_id, item.id);
    assert.equal(preview.result.blocked, true);
    assert.ok(preview.result.reasons.includes("action is in blocked_actions"));

    const audit = await (await fetch(`${base}/api/approval-audit`, { headers })).json();
    assert.equal(audit.approvals.total, 1);
    assert.equal(audit.approvals.by_operator.dashboard, 1);
    assert.equal(audit.approvals.by_type.draft_response, 1);
    assert.equal(audit.approvals.by_source.manual, 1);
    assert.equal(audit.approvals.by_status.approved, 1);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].source_id, "manual");

    const filtered = await (await fetch(`${base}/api/approval-audit?operator=dashboard&action_type=draft_response&source_id=manual&status=approved&date_from=2000-01-01&date_to=2999-01-01`, { headers })).json();
    assert.equal(filtered.approvals.total, 1);
    assert.equal(filtered.rows[0].action_id, draft.action.id);

    const decisionDate = audit.rows[0].decision_at.slice(0, 10);
    const sameDay = await (await fetch(`${base}/api/approval-audit?date_from=${decisionDate}&date_to=${decisionDate}`, { headers })).json();
    assert.equal(sameDay.approvals.total, 1);

    const empty = await (await fetch(`${base}/api/approval-audit?operator=other`, { headers })).json();
    assert.equal(empty.approvals.total, 0);

    const exported = await (await fetch(`${base}/api/approval-audit?operator=dashboard&format=csv`, { headers })).json();
    assert.match(exported.csv, /^action_id,item_id,source_id,operator,action_type,status,risk_level,decision_at,executed_at/m);
    assert.match(exported.csv, /draft_response/);
  });
});

test("dashboard can rotate its runtime API token", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const info = await (await fetch(`${base}/api/dashboard-token`, { headers })).json();
    assert.equal(info.length, "test-token".length);
    assert.ok(info.token.endsWith("-token"));
    assert.ok(info.token.startsWith("*"));
    assert.equal(info.source, "cli");
    assert.equal(info.ephemeral, false);

    const posture = await (await fetch(`${base}/api/security-posture`, { headers })).json();
    assert.equal(posture.local_only, true);
    assert.equal(posture.https, false);
    assert.equal(posture.ok, true);
    assert.deepEqual(posture.warnings, []);

    const rotated = await (await fetch(`${base}/api/dashboard-token/rotate`, { method: "POST", headers, body: "{}" })).json();
    assert.ok(rotated.token);
    assert.notEqual(rotated.token, "test-token");
    assert.equal(rotated.token_info.source, "runtime-rotated");
    assert.equal(rotated.token_info.ephemeral, true);

    const oldTokenResponse = await fetch(`${base}/api/summary`, { headers });
    assert.equal(oldTokenResponse.status, 401);
    const newTokenSummary = await fetch(`${base}/api/summary`, { headers: { "x-intake-token": rotated.token } });
    assert.equal(newTokenSummary.status, 200);
  });
});

test("dashboard persists failed source sync status", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-sync-test-"));
  let dashboard;
  try {
    await initStore(root);
    const source = makeSource("file", { id: "missing-file", name: "Missing File", config: { path: join(root, "missing") } });
    await saveSources(root, [source]);
    dashboard = await startDashboard(root, { port: 0, token: "test-token" });
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const sync = await (await fetch(`${base}/api/sources/missing-file/sync`, { method: "POST", headers, body: "{}" })).json();
    assert.equal(sync.result.ok, false);
    const [saved] = await loadSources(root);
    assert.equal(saved.last_sync_result.ok, false);
    assert.equal(saved.sync_history.length, 1);
    assert.equal(saved.sync_history[0].ok, false);
    assert.ok(saved.last_synced_at);
  } finally {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
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
    assert.equal(testedSource.test_history.length, 1);
    assert.equal(testedSource.test_history[0].ok, false);

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

test("dashboard returns precise client errors for malformed requests", async () => {
  await withDashboard(async (dashboard) => {
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };
    const malformed = await fetch(`${base}/api/settings/auto-actions`, {
      method: "POST",
      headers,
      body: "{not json"
    });
    assert.equal(malformed.status, 400);
    assert.match(await malformed.text(), /invalid JSON request body/);

    const missing = await fetch(`${base}/api/does-not-exist`, { headers });
    assert.equal(missing.status, 404);
  });
});

test("dashboard exposes quarantined attachment inventory and audited downloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-dashboard-attachments-test-"));
  const drop = join(root, "drop");
  let dashboard;
  try {
    await initStore(root);
    await mkdir(drop, { recursive: true });
    await writeFile(join(drop, "message.eml"), [
      "From: Client <client@example.test>",
      "To: Support <support@example.test>",
      "Subject: Attachment test",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=frontier",
      "",
      "--frontier",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please review the attachment.",
      "--frontier",
      "Content-Type: text/plain; name=note.txt",
      "Content-Disposition: attachment; filename=note.txt",
      "",
      "quarantined attachment body",
      "--frontier--",
      ""
    ].join("\r\n"), "utf8");
    const source = makeSource("file", {
      id: "file-mail",
      name: "File Mail",
      config: { path: drop, quarantine_attachments: true }
    });
    await saveSources(root, [source]);
    await syncAll(root, "file-mail");
    const [item] = await listItems(root);

    dashboard = await startDashboard(root, { port: 0, token: "test-token" });
    const base = `http://${dashboard.host}:${dashboard.port}`;
    const headers = { "x-intake-token": "test-token", "content-type": "application/json" };

    const inventory = await (await fetch(`${base}/api/items/${item.id}/attachments`, { headers })).json();
    assert.equal(inventory.attachments.length, 1);
    assert.equal(inventory.attachments[0].filename, "note.txt");
    assert.equal(inventory.attachments[0].downloadable, true);
    assert.equal("quarantine_path" in inventory.attachments[0], false);

    const download = await (await fetch(`${base}/api/items/${item.id}/attachments/0/download`, { headers })).json();
    assert.equal(Buffer.from(download.attachment.content_base64, "base64").toString("utf8"), "quarantined attachment body");
    const audit = await (await fetch(`${base}/api/logs?name=audit`, { headers })).json();
    assert.ok(audit.logs.some((entry) => entry.event_type === "attachment_downloaded" && entry.item_id === item.id));

    await saveItem(root, {
      ...item,
      attachments: [{ ...item.attachments[0], quarantine_path: "../outside.txt" }]
    });
    const unsafe = await fetch(`${base}/api/items/${item.id}/attachments/0/download`, { headers });
    assert.equal(unsafe.status, 500);
  } finally {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard HTML keeps icon controls accessible", async () => {
  await withDashboard(async (dashboard) => {
    const html = await (await fetch(`http://${dashboard.host}:${dashboard.port}/?token=test-token`)).text();
    assert.match(html, /aria-label="Auto-actions off"/);
    assert.match(html, /aria-label="Refresh"/);
    assert.match(html, /data-view="settings"/);
    assert.match(html, /id="logSelect"/);
    assert.match(html, /First source setup/);
    assert.match(html, /Source setup checklist/);
    assert.match(html, /INTAKE_GITHUB_API_TOKEN/);
    assert.match(html, /AI_PROVIDER_PRESETS/);
    assert.match(html, /Custom OpenAI-compatible/);
    assert.match(html, /refreshWithSync/);
    assert.match(html, /metric-btn/);
    assert.match(html, /filter-grid/);
    assert.match(html, /editor-grid/);
    assert.match(html, /newActionBody/);
    assert.match(html, /ruleTerms/);
    assert.match(html, /bulkbar/);
    assert.match(html, /selectedItemIds/);
    assert.match(html, /Resolve selected/);
    assert.match(html, /View more/);
    assert.match(html, /Archived/);
  });
});

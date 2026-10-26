import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { appendEmailDraft, sendEmailResponse, testEmailConnection, inspectEmailHistory } from "../src/adapters/email.js";
import { startDashboard } from "../src/dashboard.js";
import { initStore, saveSources } from "../src/storage.js";
import { makeSource } from "../src/models.js";
import { readBounded } from "../src/resource-limits.js";
import { readStreamText } from "../src/util.js";

test("fragmented bounded readers fit a small heap and preserve all bytes", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { readBounded } from './src/resource-limits.js';
    import { readStreamText } from './src/util.js';
    const count = 1024 * 1024;
    function* chunks() { const byte = Buffer.from('x'); for(let i=0;i<count;i++) { yield Buffer.alloc(0); yield byte; } }
    assert.equal((await readBounded(chunks(),count,'test')).length,count);
    assert.equal(await readStreamText(chunks(),{maxBytes:count}), 'x'.repeat(count));
    console.log('PASS fragmented byte and text readers');
  `;
  const child = spawnSync(process.execPath, ["--max-old-space-size=48", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /PASS fragmented/);
});

test("bounded readers count UTF-8 text and preserve iterator errors and cleanup", async () => {
  await assert.rejects(() => readBounded(["🙂"], 3, "text"), /text exceeds 3 bytes/);
  assert.equal((await readBounded(["🙂"], 4, "text")).toString(), "🙂");
  let closed = false;
  async function* failing() { try { yield Buffer.from("a"); throw new Error("input failed"); } finally { closed = true; } }
  await assert.rejects(() => readStreamText(failing()), /input failed/);
  assert.equal(closed, true);
  await assert.rejects(() => readStreamText([Buffer.from("ab")], { maxBytes: 1 }), { statusCode: 413 });
  function* reused() { const buffer = Buffer.from("a"); yield buffer; buffer[0] = 98; yield buffer; }
  assert.equal((await readBounded(reused(), 2, "reuse")).toString(), "ab");
});

function mockMail(t) {
  process.env.INTAKE_FAILURE_MAIL_KEY = "fixture";
  t.after(() => delete process.env.INTAKE_FAILURE_MAIL_KEY);
  t.mock.method(ImapFlow.prototype, "connect", async () => {});
  const state = { closed: 0 };
  t.mock.method(ImapFlow.prototype, "close", () => { state.closed++; });
  const source = { id: "mail", secret_ref: "env:INTAKE_FAILURE_MAIL_KEY", config: { username: "fixture@example.test" } };
  return { state, source };
}

test("failed IMAP append preserves the primary error when logout also fails", async (t) => {
  const { state, source } = mockMail(t);
  const primary = new Error("append failed");
  t.mock.method(ImapFlow.prototype, "append", async () => { throw primary; });
  t.mock.method(ImapFlow.prototype, "logout", async () => { throw new Error("logout failed"); });
  await assert.rejects(() => appendEmailDraft(source, { body: "draft" }, { title: "Subject" }), (error) => error === primary);
  assert.equal(state.closed, 1);
});

test("IMAP append and readiness force-close failed logout connections", async (t) => {
  const { state, source } = mockMail(t);
  t.mock.method(ImapFlow.prototype, "append", async () => true);
  t.mock.method(ImapFlow.prototype, "logout", async () => { throw new Error("logout failed"); });
  t.mock.method(nodemailer, "createTransport", () => ({ verify: async () => true, close() {} }));
  await assert.rejects(() => appendEmailDraft(source, { body: "draft" }, { title: "Subject" }), /logout failed/);
  assert.equal(state.closed, 1);
  await testEmailConnection(source);
  assert.equal(state.closed, 2);
});

test("SMTP validates the recipient before acquiring a transport", async (t) => {
  let created = 0;
  t.mock.method(nodemailer, "createTransport", () => { created++; return { close() {} }; });
  const { source } = mockMail(t);
  await assert.rejects(() => sendEmailResponse(source, { body: "draft" }, {}), /author_email/);
  assert.equal(created, 0);
});

test("failed dashboard startup closes its listening socket", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "intake-startup-failure-"));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const listen = Server.prototype.listen;
  t.mock.method(Server.prototype, "listen", function (...args) {
    server = this;
    const ready = args.pop();
    return listen.call(this, ...args, () => {
      const audit = join(root, "logs", "audit.jsonl");
      rmSync(audit);
      mkdirSync(audit);
      ready();
    });
  });
  await assert.rejects(() => startDashboard(root, { port: 0 }), /EISDIR/);
  assert.equal(server.listening, false);
});

test("source readiness CLI exits unsuccessfully with a structured failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "intake-readiness-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initStore(root);
  await saveSources(root, [makeSource("file", { id: "broken", config: {} })]);
  const child = spawnSync(process.execPath, ["bin/intake.js", "source", "test", "broken", "--json", "--dir", root], { encoding: "utf8" });
  assert.equal(JSON.parse(child.stdout).ok, false);
  assert.equal(child.status, 1);
});

test("IPv6 loopback dashboard exposes a usable launch URL and authenticated API", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "intake-ipv6-"));
  let dashboard;
  t.after(async () => {
    if (dashboard) await new Promise((resolve) => dashboard.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  try { dashboard = await startDashboard(root, { host: "::1", port: 0, token: "ipv6-test" }); }
  catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) return t.skip("IPv6 loopback is unavailable on this host");
    throw error;
  }
  const url = new URL(dashboard.url);
  assert.equal(url.hostname, "[::1]");
  const response = await fetch(`${url.origin}/api/settings`, { headers: { "x-intake-token": dashboard.token } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.auto_actions_enabled, false);
});


test("draft append retains provider identity and never constructs SMTP", async (t) => {
  const { source } = mockMail(t);
  t.mock.method(nodemailer, "createTransport", () => { throw new Error("SMTP must not be used"); });
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "append", async (folder, raw, flags) => {
    assert.equal(folder, "Drafts");assert.deepEqual(flags, ["\\Draft"]);
    assert.match(raw.toString(), /Message-ID: <stable@example.test>/);
    assert.match(raw.toString(), /charset=UTF-8/);
    return { uid: 42, uidValidity: 123n };
  });
  const receipt = await appendEmailDraft(source, { body: "Reviewed draft", metadata: { draft_message_id: "<stable@example.test>", subject: "Specific subject" } }, { author_email: "prospect@example.test" });
  assert.deepEqual(receipt, { appended_to: "Drafts", uid: "42", uid_validity: "123", message_id: "<stable@example.test>" });
});

test("history inspects every selectable folder read-only and fails closed", async (t) => {
  const { source } = mockMail(t);const seen=[];
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "list", async () => [{path:"INBOX",flags:new Set()}, {path:"Sent",flags:new Set()}, {path:"Parent",flags:new Set(["\\Noselect"])}]);
  t.mock.method(ImapFlow.prototype, "getMailboxLock", async (path, options) => { assert.equal(options.readOnly,true);seen.push(path);return {release(){}}; });
  t.mock.method(ImapFlow.prototype, "search", async () => [42]);
  const result=await inspectEmailHistory(source,["Specific Gym"]);
  assert.deepEqual(seen,["INBOX","Sent"]);assert.equal(result.matches.length,2);assert.equal(result.complete,true);
  t.mock.method(ImapFlow.prototype, "search", async () => { throw Error("folder unavailable"); });
  await assert.rejects(inspectEmailHistory(source,["Specific Gym"]),/folder unavailable/);
});

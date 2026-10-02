import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceFromInput } from "../src/source-config.js";

test("source config parses string booleans without changing intent", () => {
  const email = buildSourceFromInput({
    type: "email",
    id: "support-email",
    username: "support@example.test",
    password_env: "INTAKE_SUPPORT_PASSWORD",
    insecure: "false",
    enabled: "false",
    quarantine_attachments: "false"
  });

  assert.equal(email.enabled, false);
  assert.equal(email.config.imap.secure, true);
  assert.equal(email.config.smtp.secure, true);
  assert.equal(email.config.quarantine_attachments, false);
});

test("source config preserves existing insecure email transport unless changed", () => {
  const existing = buildSourceFromInput({
    type: "email",
    id: "support-email",
    username: "support@example.test",
    password_env: "INTAKE_SUPPORT_PASSWORD",
    insecure: true
  });
  const updated = buildSourceFromInput({ name: "Support" }, existing);

  assert.equal(updated.config.imap.secure, false);
  assert.equal(updated.config.smtp.secure, false);
});

test("source config validates ports and poll intervals", () => {
  assert.throws(
    () => buildSourceFromInput({ type: "email", id: "bad-email", imap_port: "abc", password_env: "INTAKE_PASSWORD" }),
    /imap port must be a finite number/
  );
  assert.throws(
    () => buildSourceFromInput({ type: "slack", id: "bad-slack", port: "0" }),
    /slack port must be at least 1/
  );
  assert.throws(
    () => buildSourceFromInput({ type: "manual", id: "bad-poll", poll_interval_minutes: "never" }),
    /poll interval must be a finite number/
  );
});

test("source config can clear allowed action restrictions", () => {
  const existing = buildSourceFromInput({
    type: "file",
    id: "file-drop",
    path: "/tmp/intake",
    allowed_actions: "draft_response,mark_resolved"
  });
  const updated = buildSourceFromInput({ allowed_actions: "" }, existing);

  assert.deepEqual(updated.config.allowed_actions, []);
});

test("source config validates GitHub writeback resource limits", () => {
  const source = buildSourceFromInput({
    type: "github",
    id: "github",
    token: "fixture",
    github_timeout_ms: "2500",
    github_max_request_bytes: "2048",
    github_max_response_bytes: "4096"
  });
  assert.equal(source.config.github_timeout_ms, 2500);
  assert.equal(source.config.github_max_request_bytes, 2048);
  assert.equal(source.config.github_max_response_bytes, 4096);
  assert.throws(
    () => buildSourceFromInput({ type: "github", id: "github", github_timeout_ms: 0 }),
    /github_timeout_ms must be a positive integer/
  );
});

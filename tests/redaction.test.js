import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redaction.js";

test("redacts realistic mail and webhook secrets from logs", () => {
  const entry = redact({
    error: "SMTP AUTH failed for support@example.com:super-secret-password token=abc123",
    authorization: "Bearer slack-token",
    nested: {
      imap_password: "mailbox-password",
      url: "https://example.test/hook?api_key=secret-key"
    }
  });

  const text = JSON.stringify(entry);
  assert.equal(text.includes("super-secret-password"), false);
  assert.equal(text.includes("abc123"), false);
  assert.equal(text.includes("slack-token"), false);
  assert.equal(text.includes("mailbox-password"), false);
  assert.equal(text.includes("secret-key"), false);
  assert.ok(text.includes("[REDACTED]"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { nextUidRange, testEmailConnection } from "../src/adapters/email.js";
import { makeSource } from "../src/models.js";

test("email source test reports IMAP and SMTP readiness separately", async () => {
  delete process.env.INTAKE_MISSING_EMAIL_PASSWORD;
  const source = makeSource("email", {
    id: "support-email",
    config: {
      username: "support@example.com",
      imap: { host: "mail.privateemail.com", port: 993, secure: true },
      smtp: { host: "mail.privateemail.com", port: 465, secure: true }
    },
    secret_ref: "env:INTAKE_MISSING_EMAIL_PASSWORD"
  });

  const result = await testEmailConnection(source);

  assert.equal(result.ok, false);
  assert.equal(result.checks.config.ok, true);
  assert.equal(result.checks.imap.ok, false);
  assert.equal(result.checks.smtp.ok, false);
  assert.match(result.errors.join(" "), /INTAKE_MISSING_EMAIL_PASSWORD/);
});

test("email sync builds UID ranges from UID cursors", () => {
  assert.equal(nextUidRange({ cursor: null }, { uidNext: 10 }), "1:*");
  assert.equal(nextUidRange({ cursor: { uid: 1206 } }, { uidNext: 1349 }), "1207:*");
  assert.equal(nextUidRange({ cursor: { uid: 1348 } }, { uidNext: 1349 }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSource } from "../src/models.js";
import { initStore, listItems, saveSources } from "../src/storage.js";
import { syncAll } from "../src/workflow.js";

test("email attachments can be quarantined while item stores metadata only", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-attachment-test-"));
  const drop = join(root, "drop");
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
    assert.equal(item.attachments.length, 1);
    assert.equal(item.attachments[0].filename, "note.txt");
    assert.equal(item.attachments[0].quarantined, true);
    assert.equal("content" in item.attachments[0], false);
    const quarantinePath = join(root, item.attachments[0].quarantine_path);
    assert.equal(existsSync(quarantinePath), true);
    assert.match(await readFile(quarantinePath, "utf8"), /quarantined attachment body/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

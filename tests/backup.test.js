import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createManualItem } from "../src/adapters/manual.js";
import { createBackup, restoreBackup, verifyBackup } from "../src/backup.js";
import { makeSource } from "../src/models.js";
import { initStore, loadItem, loadSources, saveItem, saveSources } from "../src/storage.js";

test("backup create, verify, and restore round trip without local secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-backup-test-"));
  const restored = join(root, "restored");
  try {
    const store = join(root, ".intake");
    await initStore(store);
    const source = makeSource("manual", { id: "manual", name: "Manual" });
    await saveSources(store, [source]);
    const item = await createManualItem(store, source, {
      title: "Backup me",
      body: "This should survive restore."
    });
    await saveItem(store, item);
    await writeFile(join(store, ".env"), "INTAKE_SECRET=value\n", "utf8");
    await mkdir(join(store, "secrets"), { recursive: true });
    await writeFile(join(store, "secrets", "note.txt"), "do-not-back-up\n", "utf8");

    const backupPath = join(root, "intake-backup.json.gz");
    const created = await createBackup(store, { output: backupPath });
    assert.equal(created.ok, true);
    assert.ok(created.file_count > 0);

    const backupJson = gunzipSync(await readFile(backupPath)).toString("utf8");
    assert.equal(backupJson.includes("INTAKE_SECRET"), false);
    assert.equal(backupJson.includes("do-not-back-up"), false);

    const verified = await verifyBackup(backupPath);
    assert.equal(verified.ok, true);

    const result = await restoreBackup(backupPath, restored);
    assert.equal(result.ok, true);
    assert.equal((await loadSources(restored))[0].id, "manual");
    assert.equal((await loadItem(restored, item.id)).title, "Backup me");
    assert.equal(await readFile(join(restored, "secrets", "README.md"), "utf8").then(() => true), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup restore refuses non-empty targets unless forced", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-backup-force-test-"));
  try {
    const store = join(root, ".intake");
    const target = join(root, "target");
    await initStore(store);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "keep.txt"), "existing", "utf8");
    const backupPath = join(root, "intake-backup.json.gz");
    await createBackup(store, { output: backupPath });

    await assert.rejects(() => restoreBackup(backupPath, target), /not empty/);
    const forced = await restoreBackup(backupPath, target, { force: true });
    assert.equal(forced.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup create can rotate old backups", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-backup-rotate-test-"));
  try {
    const store = join(root, ".intake");
    const backupDir = join(store, "backups");
    await initStore(store);
    await createBackup(store, { output: join(backupDir, "one.json.gz") });
    await createBackup(store, { output: join(backupDir, "two.json.gz") });
    const rotated = await createBackup(store, { output: join(backupDir, "three.json.gz"), keep: 2 });
    assert.equal(rotated.rotation.removed.length, 1);
    const backups = (await readdir(backupDir)).filter((name) => name.endsWith(".json.gz"));
    assert.equal(backups.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

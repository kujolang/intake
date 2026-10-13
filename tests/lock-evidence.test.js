import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { initStore } from "../src/storage.js";
import { recoverStoreLock } from "../src/store-lock.js";

test("falsy lock-owner records require explicit force and preserve evidence otherwise", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "intake-lock-evidence-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "store");
  await initStore(root);
  const lock = `${await realpath(root)}.intake-lock`;
  for (const value of [null, false, 0, ""]) {
    const bytes = JSON.stringify(value);
    await writeFile(lock, bytes);
    let repaired = false;
    await assert.rejects(() => recoverStoreLock(root, async () => { repaired = true; }), /ownership|owner/);
    assert.equal(repaired, false);
    assert.equal(await readFile(lock, "utf8"), bytes);
    await recoverStoreLock(root, async () => { repaired = true; }, { force: true });
    assert.equal(repaired, true);
    await assert.rejects(() => readFile(lock), { code: "ENOENT" });
  }
  for (const owner of [{ pid: process.pid, host: hostname() }, { pid: process.pid, host: `${hostname()}-other` }]) {
    const bytes = JSON.stringify(owner);
    await writeFile(lock, bytes);
    await assert.rejects(() => recoverStoreLock(root, async () => assert.fail("owner must not be stolen"), { force: true }), /still running|another host/);
    assert.equal(await readFile(lock, "utf8"), bytes);
  }
});

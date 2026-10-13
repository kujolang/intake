import { lstat, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { readJson } from "./util.js";

export function restoreJournalPath(root) { return `${root}.intake-restore.json`; }

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Called only under exclusive store ownership or the recovery gate. A journal
// describes sibling paths, never paths supplied by the archive being restored.
export async function recoverInterruptedRestore(root) {
  const path = restoreJournalPath(root);
  const journal = await readJson(path, null);
  if (journal === null && !await exists(path)) {
    if (!await exists(root)) {
      const prefix = `${basename(root)}.previous-`;
      if ((await readdir(dirname(root))).some((name) => name.startsWith(prefix))) {
        throw new Error("unjournaled interrupted restore: inspect previous store trees before recovery");
      }
    }
    return;
  }
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
  if (!journal || journal.version !== 1 || journal.root !== root ||
      !uuid.test(journal.nonce) || typeof journal.had_target !== "boolean" ||
      !["building", "ready"].includes(journal.phase)) {
    throw new Error("invalid restore journal; inspect it before recovery");
  }
  const staging = `${root}.restore-${journal.nonce}`;
  const previous = `${root}.previous-${journal.nonce}`;
  const targetExists = await exists(root);
  const previousExists = await exists(previous);
  const stagingExists = await exists(staging);
  if (journal.phase === "building") {
    if (previousExists || (journal.had_target && !targetExists)) throw new Error("inconsistent building restore journal; original store missing");
  } else if (!targetExists) {
    if (previousExists) await rename(previous, root); // Roll back the interrupted swap.
    else if (!journal.had_target && stagingExists) await rename(staging, root);
    else throw new Error("cannot recover restore: original and installed store are missing");
  } else if (previousExists && stagingExists) {
    throw new Error("ambiguous restore state; preserve all trees for inspection");
  }
  // A target with no staging tree means installation completed. Cleanup is
  // repeatable even if this recovery process exits between these removals.
  await rm(staging, { recursive: true, force: true });
  await rm(`${staging}.intake-lock`, { force: true });
  await rm(previous, { recursive: true, force: true });
  await rm(path);
}

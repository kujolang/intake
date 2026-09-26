import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serializeWrite } from "./util.js";

// All actions share a lock so auto-action budgets are checked and updated together.
// Never steal a lock: an interrupted outbound operation needs operator reconciliation.
export function withActionLock(root, operation) {
  const lock = resolve(root, ".action-lock");
  return serializeWrite(lock, async () => {
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const busy = new Error("action execution is locked; stop other writers and reconcile interrupted actions before removing .action-lock");
      busy.statusCode = 409;
      throw busy;
    }
    try {
      await writeFile(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }), { flag: "wx" });
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  });
}

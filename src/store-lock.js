import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { serializeWrite } from "./util.js";

const context = new AsyncLocalStorage();

async function identity(root) {
  const absolute = resolve(root);
  let canonical;
  try { canonical = await realpath(absolute); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(dirname(absolute), { recursive: true });
    canonical = resolve(await realpath(dirname(absolute)), basename(absolute));
  }
  return { root: canonical, lock: `${canonical}.intake-lock`, recovery: `${canonical}.intake-recovery` };
}

function conflict(message) {
  const error = new Error(message);
  error.code = "INTAKE_STORE_BUSY";
  error.statusCode = 409;
  return error;
}

async function absent(path) {
  try { await access(path); return false; }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
}

// Reentrant across awaited calls, but never across independent requests/processes.
// The sibling lock survives a restore replacing the entire store directory.
export async function withStoreLock(root, operation) {
  const active = context.getStore();
  const absolute = resolve(root);
  if (active?.active && active.aliases.has(absolute)) return operation();
  return serializeWrite(`store-request:${absolute}`, async () => {
    const id = await identity(root);
    if (active?.active && active.root === id.root) return operation();
    return serializeWrite(id.lock, async () => {
      if (!await absent(id.recovery)) throw conflict("store recovery is in progress");
      try {
        await writeFile(id.lock, JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomUUID(), started_at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw conflict("store is locked by another operation; retry after it completes or run intake store recover after the owner exits");
      }
      const state = { root: id.root, aliases: new Set([absolute, id.root]), active: true };
      try {
        if (!await absent(id.recovery)) throw conflict("store recovery is in progress");
        return await context.run(state, operation);
      } finally {
        state.active = false;
        await rm(id.lock, { force: true });
      }
    });
  });
}

// No clock-based lease stealing: a slow provider must not lose write ownership.
export async function recoverStoreLock(root, repair, { force = false } = {}) {
  const id = await identity(root);
  return serializeWrite(id.lock, async () => {
    try { await mkdir(id.recovery); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw conflict("another recovery is active; inspect its owner before removing the recovery directory");
    }
    let state;
    try {
      await writeFile(resolve(id.recovery, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname() }), { mode: 0o600 });
      let owner;
      try { owner = JSON.parse(await readFile(id.lock, "utf8")); }
      catch (error) {
        if (!await absent(id.lock) && !force) throw conflict("lock ownership is unreadable; stop all writers and use store recover --force");
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      if (owner) {
        if (owner.host !== hostname()) throw conflict("lock belongs to another host; recovery must run on its owner host");
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw conflict("invalid lock owner pid");
        try { process.kill(owner.pid, 0); throw conflict("lock owner is still running; recovery refused"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      // Recovery gate excludes new acquisitions while indexes are reconstructed.
      state = { root: id.root, aliases: new Set([resolve(root), id.root]), active: true };
      const result = await context.run(state, repair);
      await rm(id.lock, { force: true });
      return result;
    } finally {
      if (state) state.active = false;
      await rm(id.recovery, { recursive: true, force: true });
    }
  });
}

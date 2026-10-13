import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initStore, loadPolicies, loadRules, loadSettings, saveSources, loadSources } from "../src/storage.js";
import { makeSource } from "../src/models.js";
import { main } from "../src/cli.js";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "intake-config-import-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  let root = join(base, "store");
  await initStore(root);
  root = await realpath(root);
  await saveSources(root, [makeSource("manual", { id: "original" })]);
  const payload = { version: 1, sources: [makeSource("manual", { id: "new" })], policies: await loadPolicies(root), rules: await loadRules(root), settings: { ...await loadSettings(root), marker: "imported" } };
  const input = join(base, "import.json");
  return { root, base, input, payload };
}
const cli = (args) => spawnSync(process.execPath, ["bin/intake.js", ...args], { encoding: "utf8", timeout: 20000 });
async function snapshot(root) {
  return Promise.all(["sources", "policies", "rules", "settings"].map((name) => readFile(join(root, "config", `${name}.json`), "utf8")));
}

test("config import validates all sections before replacing working configuration", async (t) => {
  const { root, input, payload } = await fixture(t);
  const before = await snapshot(root);
  for (const invalid of [
    { version: 1 }, { ...payload, rules: {} }, { ...payload, settings: [] },
    { ...payload, policies: [null] }, { ...payload, sources: [payload.sources[0], payload.sources[0]] }
  ]) {
    await writeFile(input, JSON.stringify(invalid));
    await assert.rejects(() => main(["config", "import", input, "--replace", "--dir", root]));
    assert.deepEqual(await snapshot(root), before);
  }
});

test("redacted inline credentials cannot become live config credentials", async (t) => {
  const { root, input, payload } = await fixture(t);
  const before = await snapshot(root);
  for (const key of ["token", "api_token", "signing_secret"]) {
    payload.sources[0].config = { [key]: "[REDACTED]" };
    await writeFile(input, JSON.stringify(payload));
    await assert.rejects(() => main(["config", "import", input, "--replace", "--dir", root]), /redacted/i);
    assert.deepEqual(await snapshot(root), before);
  }
});

test("interrupted config imports block ordinary access and recover the entire reviewed snapshot", async (t) => {
  const { root, input, payload } = await fixture(t);
  await writeFile(input, JSON.stringify(payload));
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{await rename(from,to);if(to===${JSON.stringify(join(root, "config", "sources.json"))})process.exit(77);};
    syncBuiltinESMExports();
    const {main}=await import('./src/cli.js');
    await main(['config','import',${JSON.stringify(input)},'--replace','--dir',${JSON.stringify(root)}]);
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 77, child.stderr);
  assert.equal(cli(["source", "list", "--dir", root]).status, 1);
  const recovery = cli(["store", "recover", "--dir", root]);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.deepEqual(await loadSources(root), payload.sources);
  assert.deepEqual(await loadSettings(root), payload.settings);
  assert.deepEqual(await loadRules(root), payload.rules);
  assert.deepEqual(await loadPolicies(root), payload.policies);
  assert.equal(cli(["store", "recover", "--dir", root]).status, 0);
});

test("config export preserves a previous output when atomic replacement fails", async (t) => {
  const { root, base } = await fixture(t);
  const output = join(base, "export.json");
  await writeFile(output, "previous evidence");
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.rename;
    fs.rename=async(from,to)=>{if(to===${JSON.stringify(output)})throw new Error('replace fault');return rename(from,to);};
    syncBuiltinESMExports();
    const {main}=await import('./src/cli.js');
    try {await main(['config','export','--output',${JSON.stringify(output)},'--dir',${JSON.stringify(root)}]);process.exitCode=2;}
    catch(e){if(!e.message.includes('replace fault'))throw e;}
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await readFile(output, "utf8"), "previous evidence");
});

test("failed config writes retain a private journal and block aliases until recovery", async (t) => {
  const { mkdir, stat, symlink } = await import("node:fs/promises");
  const { root, base, input, payload } = await fixture(t);
  const alias = join(base, "alias");
  await symlink(root, alias, "dir");
  await writeFile(input, JSON.stringify(payload));
  const rulesPath = join(root, "config", "rules.json");
  await rm(rulesPath);
  await mkdir(rulesPath);
  await assert.rejects(() => main(["config", "import", input, "--replace", "--dir", alias]));
  const journal = `${root}.intake-config-import.json`;
  const evidence = JSON.parse(await readFile(journal, "utf8"));
  assert.deepEqual(evidence.config, payload);
  if (process.platform !== "win32") assert.equal((await stat(journal)).mode & 0o777, 0o600);
  await assert.rejects(() => loadSources(alias), /interrupted config import/);
  await assert.rejects(() => loadSources(root), /interrupted config import/);
  await rm(rulesPath, { recursive: true });
  await main(["store", "recover", "--dir", alias]);
  assert.deepEqual(await loadRules(root), payload.rules);
  assert.deepEqual(await loadSettings(root), payload.settings);
  await assert.rejects(() => readFile(journal), { code: "ENOENT" });
});

test("malformed config journals fail closed even with force", async (t) => {
  const { root, payload } = await fixture(t);
  const before = await snapshot(root);
  const journal = `${root}.intake-config-import.json`;
  for (const invalid of [null, { version: 1, root: "/elsewhere", config: payload }, { version: 1, root, config: { version: 1 } }]) {
    const evidence = JSON.stringify(invalid);
    await writeFile(journal, evidence);
    await assert.rejects(() => main(["store", "recover", "--force", "--dir", root]), /config/);
    assert.deepEqual(await snapshot(root), before);
    assert.equal(await readFile(journal, "utf8"), evidence);
  }
});

test("config recovery refuses competing restore and import journals", async (t) => {
  const { root, payload } = await fixture(t);
  const before = await snapshot(root);
  await writeFile(`${root}.intake-config-import.json`, JSON.stringify({ version: 1, root, config: payload }));
  await writeFile(`${root}.intake-restore.json`, "{}");
  await assert.rejects(() => main(["store", "recover", "--force", "--dir", root]), /multiple interrupted/);
  assert.deepEqual(await snapshot(root), before);
});

test("private store journals and recovery trees are ignored by Git", () => {
  const paths = [".intake.intake-config-import.json", ".intake.intake-restore.json", ".intake.restore-fixture/config/sources.json", ".intake.previous-fixture/raw/message.json"];
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { input: paths.join("\n") + "\n", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), paths);
});

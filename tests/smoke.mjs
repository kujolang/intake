import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "intake-smoke-"));
const env = { ...process.env, INTAKE_DIR: join(root, ".intake") };

function run(args) {
  const result = spawnSync(process.execPath, ["bin/intake.js", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

try {
  run(["init"]);
  run(["onboarding", "privateemail"]);
  run(["templates", "list"]);
  run(["templates", "show", "slack-events"]);
  run(["source", "add", "manual", "--id", "manual", "--name", "Manual"]);
  run(["source", "test", "manual"]);
  run(["source", "clone", "manual", "manual-copy"]);
  run(["config", "export", "--output", join(root, "config-export.json")]);
  const itemId = run(["item", "create", "--title", "Refund request", "--body", "Please refund my payment."]);
  run(["show", itemId]);
  run(["policy", "preview", itemId, "draft_response"]);
  run(["draft", itemId]);
  const backupPath = join(root, "intake-smoke-backup.json.gz");
  run(["backup", "create", "--output", backupPath]);
  run(["backup", "verify", backupPath]);
  run(["backup", "restore", backupPath, "--target", join(root, "restored-intake")]);
  run(["doctor"]);
  run(["eval", "run"]);
  const dash = spawnSync(process.execPath, ["bin/intake.js", "dashboard", "--port", "0", "--token", "smoke-token"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 4000
  });
  if (!dash.stdout.includes("Dashboard:")) {
    throw new Error(`dashboard did not start\n${dash.stdout}\n${dash.stderr}`);
  }
  console.log("smoke ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

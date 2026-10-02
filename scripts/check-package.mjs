import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const commandOptions = {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024
};

export function findUntrackedPackageFiles(files, trackedPaths) {
  const tracked = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths);
  return files
    .map((entry) => String(entry.path || ""))
    .filter((path) => path && !tracked.has(path));
}

function fail(message, status = 1) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(status || 1);
}

function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packResult = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], commandOptions);
  if (packResult.status !== 0) {
    fail(packResult.stderr || packResult.stdout || "npm pack --dry-run failed", packResult.status);
  }

  let packs;
  try {
    packs = JSON.parse(packResult.stdout);
  } catch {
    fail("npm pack --dry-run returned invalid JSON");
  }

  const pack = Array.isArray(packs) ? packs[0] : null;
  if (!pack || !Array.isArray(pack.files)) {
    fail("npm pack --dry-run returned no package file inventory");
  }

  const gitResult = spawnSync("git", ["ls-files", "-z"], commandOptions);
  if (gitResult.status !== 0) {
    fail(gitResult.stderr || gitResult.stdout || "git ls-files failed", gitResult.status);
  }

  const tracked = new Set(gitResult.stdout.split("\0").filter(Boolean));
  const untracked = findUntrackedPackageFiles(pack.files, tracked);
  if (untracked.length) {
    const shown = untracked.slice(0, 10);
    const suffix = untracked.length > shown.length ? `, and ${untracked.length - shown.length} more` : "";
    fail(`package contains ${untracked.length} untracked file(s): ${shown.join(", ")}${suffix}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    filename: pack.filename,
    size: pack.size,
    unpacked_size: pack.unpackedSize,
    files: pack.entryCount,
    tracked_only: true
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

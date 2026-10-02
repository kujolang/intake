import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "npm pack --dry-run failed\n");
  process.exit(result.status || 1);
}

let packs;
try {
  packs = JSON.parse(result.stdout);
} catch {
  process.stderr.write("npm pack --dry-run returned invalid JSON\n");
  process.exit(1);
}

const pack = Array.isArray(packs) ? packs[0] : null;
if (!pack || !Array.isArray(pack.files)) {
  process.stderr.write("npm pack --dry-run returned no package file inventory\n");
  process.exit(1);
}

const forbidden = pack.files
  .map((entry) => String(entry.path || ""))
  .filter((path) =>
    path.startsWith("docs/audits/artifacts/") && path.endsWith(".log")
  );

if (forbidden.length) {
  process.stderr.write(`package contains transient audit logs: ${forbidden.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  filename: pack.filename,
  size: pack.size,
  unpacked_size: pack.unpackedSize,
  files: pack.entryCount
}, null, 2)}\n`);

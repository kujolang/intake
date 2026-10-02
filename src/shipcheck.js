import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runDoctor } from "./doctor.js";
import { runEvals } from "./evals.js";

const REQUIRED_ROOT_ENTRIES = [
  ".github",
  ".gitignore",
  "bin",
  "CHANGELOG.md",
  "config",
  "CONTRIBUTING.md",
  "docs",
  "LICENSE",
  "package-lock.json",
  "package.json",
  "README.md",
  "scripts",
  "src",
  "tests"
];

const IGNORED_ROOT_ENTRIES = new Set([
  ".DS_Store",
  ".git",
  ".intake",
  "node_modules"
]);

export async function runShipcheck(root, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const [doctor, evals, packageJson, workflowText, rootEntries] = await Promise.all([
    runDoctor(root),
    runEvals(),
    readPackage(projectRoot),
    readText(join(projectRoot, ".github", "workflows", "verify.yml")),
    readdir(projectRoot).catch(() => [])
  ]);

  const checks = [
    check("doctor", doctor.ok, doctor.ok ? "doctor passed" : "doctor failed"),
    check("evals", evals.ok, evals.ok ? `${evals.passed} evals passed` : `${evals.failed} evals failed`),
    packageMetadataCheck(packageJson),
    packageFilesCheck(packageJson),
    releaseScriptsCheck(packageJson),
    ciWorkflowCheck(workflowText),
    rootFilesCheck(rootEntries)
  ];
  if (packageJson.private === true) {
    checks.push({ id: "package-private", status: "warn", message: "`private` remains true until the remaining live-source and release gates are proven" });
  }

  const blockers = [
    "Live PrivateEmail smoke test evidence is not captured by local shipcheck.",
    "Live Slack smoke test evidence is not captured by local shipcheck.",
    "Remote GitHub Actions evidence is not captured by local shipcheck and must be verified separately."
  ];
  const ok = checks.every((item) => item.status !== "fail");
  return {
    ok,
    enterprise_ready: ok && blockers.length === 0,
    checks,
    blockers,
    doctor,
    evals
  };
}

async function readPackage(projectRoot) {
  try {
    return JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function readText(path) {
  return readFile(path, "utf8").catch(() => "");
}

function check(id, passed, message) {
  return { id, status: passed ? "ok" : "fail", message };
}

function packageMetadataCheck(pkg) {
  const required = [
    ["name", pkg.name],
    ["version", pkg.version],
    ["description", pkg.description],
    ["author.name", pkg.author?.name],
    ["author.email", pkg.author?.email],
    ["repository.url", pkg.repository?.url],
    ["bugs.url", pkg.bugs?.url],
    ["homepage", pkg.homepage],
    ["license", pkg.license],
    ["bin.intake", pkg.bin?.intake],
    ["engines.node", pkg.engines?.node],
    ["publishConfig.access", pkg.publishConfig?.access]
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return check("package-metadata", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : "package metadata is complete");
}

function packageFilesCheck(pkg) {
  const expected = [
    "bin/",
    "src/",
    "docs/",
    "!docs/audits/artifacts/**/*.log",
    "scripts/",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ];
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const missing = expected.filter((entry) => !files.includes(entry));
  return check("package-files", missing.length === 0, missing.length ? `package files missing ${missing.join(", ")}` : "package files whitelist is complete");
}

function releaseScriptsCheck(pkg) {
  const scripts = pkg.scripts || {};
  const required = ["lint", "test", "smoke", "verify", "bench:gate", "release:check"];
  const missing = required.filter((name) => !scripts[name]);
  const verifyIncludesBench = String(scripts.verify || "").includes("bench:gate");
  const releaseIncludesVerify = String(scripts["release:check"] || "").includes("npm run verify");
  const releaseIncludesDoctor = String(scripts["release:check"] || "").includes("doctor");
  const releaseIncludesPack = String(scripts["release:check"] || "").includes("check-package.mjs");
  const failures = [
    ...missing.map((name) => `missing ${name}`),
    verifyIncludesBench ? null : "verify must include bench:gate",
    releaseIncludesVerify ? null : "release:check must run verify",
    releaseIncludesDoctor ? null : "release:check must run doctor",
    releaseIncludesPack ? null : "release:check must run the package-content gate"
  ].filter(Boolean);
  return check("release-scripts", failures.length === 0, failures.join("; ") || "release scripts are wired");
}

function ciWorkflowCheck(workflowText) {
  const failures = [
    workflowText ? null : "missing .github/workflows/verify.yml",
    workflowText.includes("npm ci") ? null : "workflow must run npm ci",
    workflowText.includes("npm run verify") ? null : "workflow must run npm run verify",
    workflowText.includes("20") && workflowText.includes("22") ? null : "workflow must cover Node 20 and 22"
  ].filter(Boolean);
  return check("ci-workflow", failures.length === 0, failures.join("; ") || "CI workflow is wired");
}

function rootFilesCheck(rootEntries) {
  const entries = new Set(rootEntries);
  const missing = REQUIRED_ROOT_ENTRIES.filter((entry) => !entries.has(entry));
  const extras = rootEntries.filter((entry) => !REQUIRED_ROOT_ENTRIES.includes(entry) && !ignoredRootEntry(entry));
  if (missing.length) return check("root-files", false, `missing ${missing.join(", ")}`);
  return {
    id: "root-files",
    status: extras.length ? "warn" : "ok",
    message: extras.length ? `unexpected root entries: ${extras.join(", ")}` : "root files are intentional"
  };
}

function ignoredRootEntry(entry) {
  return IGNORED_ROOT_ENTRIES.has(entry) || entry.endsWith(".intake-lock") || entry.endsWith(".intake-recovery");
}

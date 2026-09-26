#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const flags = parseArgs(process.argv.slice(2));
const benchArgs = [
  "--items", flags.items || "500",
  "--logs", flags.logs || "1000",
  "--fileRows", flags.fileRows || "250",
  "--actions", flags.actions || "500",
  "--learnings", flags.learnings || "500"
];
const thresholds = {
  dashboard_logs_page_200_warm: positiveNumber(flags.dashboardLogsMs ?? 1000, "dashboardLogsMs"),
  dashboard_summary_warm: positiveNumber(flags.dashboardSummaryMs ?? 1500, "dashboardSummaryMs"),
  dashboard_items_page_100_warm: positiveNumber(flags.dashboardItemsMs ?? 1000, "dashboardItemsMs"),
  dashboard_actions_page_100_warm: positiveNumber(flags.dashboardActionsMs ?? 1000, "dashboardActionsMs"),
  dashboard_learnings_page_100_warm: positiveNumber(flags.dashboardLearningsMs ?? 1000, "dashboardLearningsMs"),
  dashboard_approval_audit_warm: positiveNumber(flags.dashboardApprovalAuditMs ?? 1500, "dashboardApprovalAuditMs"),
  sync_repeated_dedupe: positiveNumber(flags.syncRepeatedDedupeMs ?? 1000, "syncRepeatedDedupeMs")
};

const result = spawnSync(process.execPath, ["scripts/bench.mjs", ...benchArgs], {
  cwd: process.cwd(),
  encoding: "utf8"
});

if (result.status !== 0) {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status || 1);
}

const output = parseJsonOutput(result.stdout);
const timings = Object.fromEntries(output.timings_ms.map((timing) => [timing.name, timing.ms]));
const failures = [];
for (const [name, maxMs] of Object.entries(thresholds)) {
  if (!(name in timings)) {
    failures.push(`${name}: missing timing`);
  } else if (timings[name] > maxMs) {
    failures.push(`${name}: ${timings[name]}ms > ${maxMs}ms`);
  }
}

const report = {
  ok: failures.length === 0,
  thresholds_ms: thresholds,
  timings_ms: timings,
  failures
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);

function parseJsonOutput(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("benchmark did not produce JSON output");
  return JSON.parse(text.slice(start, end + 1));
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    out[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return out;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    console.error(`--${name} must be a positive number`);
    process.exit(2);
  }
  return number;
}

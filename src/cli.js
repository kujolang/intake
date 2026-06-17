import { readFile, writeFile } from "node:fs/promises";
import { testSource } from "./adapters/index.js";
import { createBackup, restoreBackup, verifyBackup } from "./backup.js";
import { createManualItem } from "./adapters/manual.js";
import { isIssueSourceType, startIssueWebhookServer } from "./adapters/issues.js";
import { startSlackServer } from "./adapters/slack.js";
import { startWebhookServer } from "./adapters/webhook.js";
import { VERSION } from "./constants.js";
import { startDashboard } from "./dashboard.js";
import { clearDemo, seedEmailDemo } from "./demo.js";
import { runDoctor } from "./doctor.js";
import { runEvals } from "./evals.js";
import { exportStrataDaily, exportTotalRecall } from "./exports.js";
import { makeAction, makeSource } from "./models.js";
import { evaluatePolicy } from "./policy.js";
import { purgeItems, applyRetention } from "./retention.js";
import { explainRules, proposeRuleFromItem } from "./rules.js";
import { printJson, printTable } from "./render.js";
import { buildSourceFromInput, sanitizeSources } from "./source-config.js";
import { appendSourceTestHistory } from "./source-history.js";
import { getSourceTemplate, listSourceTemplates } from "./source-templates.js";
import {
  initStore,
  listActions,
  listItems,
  listLearnings,
  loadAction,
  loadItem,
  loadPolicies,
  loadRules,
  loadSettings,
  loadSources,
  readRaw,
  rebuildItemIndex,
  resolveIntakeDir,
  saveAction,
  saveItem,
  savePolicies,
  saveRules,
  saveSettings,
  saveSources,
  logEvent
} from "./storage.js";
import {
  approveAction,
  classifyAndSave,
  createLearning,
  proposeDraft,
  rejectAction,
  runAction,
  setAutoActions,
  syncAll
} from "./workflow.js";
import { assertSafeId, isoNow, parseCsv } from "./util.js";

export async function main(argv) {
  const parsed = parseArgs(argv);
  const root = resolveIntakeDir(parsed.flags);
  const [command, subcommand, third] = parsed.positionals;

  if (!command || parsed.flags.help) return help();
  if (command === "version" || command === "--version") return console.log(VERSION);
  if (command === "init") return cmdInit(root);
  if (command === "doctor") return cmdDoctor(root, parsed.flags);
  if (command === "onboarding") return cmdOnboarding(subcommand, parsed.flags);
  if (command === "config") return cmdConfig(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "dashboard") return cmdDashboard(root, parsed.flags);
  if (command === "demo") return cmdDemo(root, subcommand, third, parsed.flags);
  if (command === "source") return cmdSource(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "templates") return cmdTemplates(subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "item") return cmdItem(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "sync") return cmdSync(root, subcommand);
  if (command === "watch") return cmdWatch(root, parsed.flags);
  if (command === "items") return cmdItems(root, parsed.flags);
  if (command === "show") return cmdShow(root, subcommand, parsed.flags);
  if (command === "raw") return cmdRaw(root, subcommand);
  if (command === "classify") return cmdClassify(root, subcommand, parsed.flags);
  if (command === "queue") return cmdQueue(root, subcommand, third);
  if (command === "tag") return cmdTag(root, subcommand, third);
  if (command === "assign") return cmdAssign(root, subcommand, third, parsed.flags);
  if (command === "draft") return cmdDraft(root, subcommand, parsed.flags);
  if (command === "actions") return cmdActions(root, parsed.flags);
  if (command === "action") return cmdAction(root, subcommand, third, parsed.flags);
  if (command === "approve") return printJson(await approveAction(root, subcommand, parsed.flags.by));
  if (command === "reject") return printJson(await rejectAction(root, subcommand, parsed.flags.by));
  if (command === "run") return printJson(await runAction(root, subcommand));
  if (command === "resolve") return cmdResolve(root, subcommand);
  if (command === "block") return cmdBlock(root, subcommand);
  if (command === "learn") return printJson(await createLearning(root, subcommand, parsed.flags));
  if (command === "learnings") return cmdLearnings(root, parsed.flags);
  if (command === "strata" && subcommand === "daily") return console.log(await exportStrataDaily(root, parsed.flags));
  if (command === "totalrecall" && subcommand === "export") return console.log(await exportTotalRecall(root, parsed.flags));
  if (command === "rules") return cmdRules(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "policy") return cmdPolicy(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "backup") return cmdBackup(root, subcommand, parsed.positionals.slice(2), parsed.flags);
  if (command === "retention") return cmdRetention(root, subcommand, parsed.flags);
  if (command === "purge") return cmdPurge(root, subcommand, parsed.flags);
  if (command === "eval" && subcommand === "run") return cmdEval(parsed.flags);
  if (command === "shipcheck") return cmdShipcheck(root);
  if (command === "auto-actions") return cmdAutoActions(root, subcommand);
  throw new Error(`unknown command: ${command}`);
}

async function cmdInit(root) {
  await initStore(root);
  console.log(`Initialized Kujo Intake at ${root}`);
  console.log("Next: intake source add manual --name Manual");
}

async function cmdDoctor(root, flags) {
  await initStore(root);
  if (flags.fix) {
    await rebuildItemIndex(root);
    await logEvent(root, "audit", { event_type: "doctor_fix", status: "ok" });
  }
  const result = await runDoctor(root);
  if (flags.json) return printJson(result);
  for (const check of result.checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.id} - ${check.message}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function cmdDashboard(root, flags) {
  const dashboard = await startDashboard(root, flags);
  console.log(`Dashboard: ${dashboard.url}`);
  console.log("Bind: 127.0.0.1 only");
  await new Promise(() => {});
}

async function cmdDemo(root, subcommand, third, flags) {
  if (subcommand === "seed" && (third === "email" || !third)) {
    const result = await seedEmailDemo(root);
    return flags.json ? printJson(result) : console.log(`Seeded demo email interaction: ${result.item_id}`);
  }
  if (subcommand === "clear") {
    const result = await clearDemo(root);
    return flags.json ? printJson(result) : console.log(`Cleared demo seed: ${result.seed_id}`);
  }
  throw new Error("usage: intake demo seed email | intake demo clear");
}

async function cmdSource(root, subcommand, args, flags) {
  await initStore(root);
  if (subcommand === "add") {
    const type = args[0] || flags.type;
    if (!type) throw new Error("usage: intake source add <manual|file|email|webhook|slack|github|jira|linear|clickup> [--name NAME]");
    const source = buildSourceFromInput({ ...flags, type, queue: flags.queue || "inbox" });
    const sources = await loadSources(root);
    if (sources.some((candidate) => candidate.id === source.id)) {
      throw new Error(`source already exists: ${source.id}`);
    }
    sources.push(source);
    await saveSources(root, sources);
    await logEvent(root, "audit", { source_id: source.id, event_type: "source_added" });
    return printJson(source);
  }
  if (subcommand === "list") {
    const sources = await loadSources(root);
    return printTable(sources.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled, name: s.name })), ["id", "type", "enabled", "name"]);
  }
  if (subcommand === "test") {
    const sources = await loadSources(root);
    const source = sources.find((candidate) => candidate.id === args[0]);
    if (!source) throw new Error(`no such source: ${args[0]}`);
    const result = await testSource(source);
    const testedAt = isoNow();
    await saveSources(root, sources.map((candidate) => candidate.id === source.id ? appendSourceTestHistory({
      ...candidate,
      last_tested_at: testedAt,
      last_test_result: result,
      updated_at: testedAt
    }, result, testedAt) : candidate));
    await logEvent(root, result.ok ? "audit" : "errors", {
      source_id: source.id,
      event_type: "source_tested",
      status: result.ok ? "ok" : "failed",
      error: result.errors?.join("; ") || null
    });
    return flags.json ? printJson(result) : printSourceTest(result);
  }
  if (subcommand === "enable" || subcommand === "disable") {
    const id = args[0];
    const sources = await loadSources(root);
    const next = sources.map((source) => source.id === id ? { ...source, enabled: subcommand === "enable", updated_at: isoNow() } : source);
    await saveSources(root, next);
    return console.log(`${subcommand}d ${id}`);
  }
  if (subcommand === "remove") {
    const id = args[0];
    const sources = await loadSources(root);
    const next = sources.filter((source) => source.id !== id);
    if (next.length === sources.length) throw new Error(`no such source: ${id}`);
    await saveSources(root, next);
    await logEvent(root, "audit", { source_id: id, event_type: "source_removed" });
    return console.log(`removed ${id}`);
  }
  if (subcommand === "clone") {
    const [id, newId] = args;
    if (!id || !newId) throw new Error("usage: intake source clone SOURCE_ID NEW_SOURCE_ID");
    const sources = await loadSources(root);
    const source = sources.find((candidate) => candidate.id === id);
    if (!source) throw new Error(`no such source: ${id}`);
    if (sources.some((candidate) => candidate.id === newId)) throw new Error(`source already exists: ${newId}`);
    const safeNewId = assertSafeId(newId, "source id");
    const clone = makeSource(source.type, {
      ...source,
      id: safeNewId,
      name: `${source.name} Copy`,
      enabled: false,
      cursor: null,
      last_tested_at: null,
      last_test_result: null,
      last_synced_at: null,
      last_sync_result: null
    });
    await saveSources(root, [...sources, clone]);
    await logEvent(root, "audit", { source_id: safeNewId, event_type: "source_cloned", input_refs: [id] });
    return printJson(clone);
  }
  throw new Error(`unknown source command: ${subcommand}`);
}

async function cmdConfig(root, subcommand, args, flags) {
  await initStore(root);
  if (subcommand === "export") {
    const payload = {
      version: 1,
      exported_at: isoNow(),
      sources: flags.includeSecrets ? await loadSources(root) : sanitizeSources(await loadSources(root)),
      policies: await loadPolicies(root),
      rules: await loadRules(root),
      settings: await loadSettings(root)
    };
    const output = flags.output;
    if (output) {
      await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return console.log(output);
    }
    return printJson(payload);
  }
  if (subcommand === "import") {
    const path = args[0] || flags.path;
    if (!path) throw new Error("usage: intake config import CONFIG_PATH [--replace]");
    const payload = JSON.parse(await readFile(path, "utf8"));
    if (!payload || payload.version !== 1) throw new Error("unsupported config export");
    if (flags.replace !== true) throw new Error("config import requires --replace to avoid accidental overwrite");
    await saveSources(root, payload.sources || []);
    await savePolicies(root, payload.policies || []);
    await saveRules(root, payload.rules || []);
    if (payload.settings) await saveSettings(root, payload.settings);
    await logEvent(root, "audit", { event_type: "config_imported", status: "ok", input_refs: [path] });
    return printJson({ ok: true, imported: path });
  }
  throw new Error("usage: intake config export|import");
}

function cmdOnboarding(topic, flags) {
  const steps = onboardingSteps(topic || "privateemail");
  if (flags.json) return printJson(steps);
  console.log(`# ${steps.title}`);
  for (const [index, step] of steps.steps.entries()) console.log(`${index + 1}. ${step}`);
}

async function cmdTemplates(subcommand, args, flags) {
  if (subcommand === "list" || !subcommand) {
    const templates = listSourceTemplates();
    return flags.json ? printJson(templates) : printTable(templates, ["id", "type", "name", "description"]);
  }
  if (subcommand === "show") {
    const template = getSourceTemplate(args[0]);
    if (!template) throw new Error(`no such template: ${args[0]}`);
    return printJson(template);
  }
  throw new Error("usage: intake templates list|show TEMPLATE_ID");
}

async function cmdItem(root, subcommand, args, flags) {
  await initStore(root);
  if (subcommand !== "create") throw new Error(`unknown item command: ${subcommand}`);
  const sources = await loadSources(root);
  let source = sources.find((candidate) => candidate.id === (flags.source || "manual") || candidate.type === (flags.source || "manual"));
  if (!source) {
    source = makeSource("manual", { id: "manual", name: "Manual", default_queue: flags.queue || "inbox" });
    await saveSources(root, [...sources, source]);
  }
  if (!flags.title || !flags.body) throw new Error("usage: intake item create --title TEXT --body TEXT [--queue QUEUE]");
  const item = await createManualItem(root, source, {
    title: flags.title,
    body: flags.body,
    queue: flags.queue || source.default_queue,
    author: flags.author,
    tags: parseCsv(flags.tags)
  });
  await saveItem(root, item);
  await classifyAndSave(root, item.id);
  console.log(item.id);
}

async function cmdSync(root, sourceId) {
  await initStore(root);
  const result = await syncAll(root, sourceId || null);
  return printJson(result);
}

async function cmdWatch(root, flags) {
  await initStore(root);
  const sources = await loadSources(root);
  const webhook = sources.find((source) => source.enabled && (["webhook", "slack"].includes(source.type) || isIssueSourceType(source.type)) && (!flags.source || source.id === flags.source));
  if (webhook) {
    const receiver = webhook.type === "slack"
      ? await startSlackServer(root, webhook, flags)
      : isIssueSourceType(webhook.type)
        ? await startIssueWebhookServer(root, webhook, flags)
        : await startWebhookServer(root, webhook, flags);
    console.log(`${webhook.type === "slack" ? "Slack receiver" : `${webhook.type} receiver`} listening on ${receiver.url}`);
    await new Promise(() => {});
    return;
  }
  const interval = Number(flags.interval || 60) * 1000;
  console.log(`Watching sources every ${interval / 1000}s. Press Ctrl+C to stop.`);
  while (true) {
    await syncAll(root, flags.source || null);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function cmdItems(root, flags) {
  await initStore(root);
  const filters = {
    queue: flags.queue,
    source_id: flags.source,
    tag: flags.tag,
    risk_level: flags.risk,
    status: flags.status,
    limit: flags.limit,
    offset: flags.offset
  };
  const items = await listItems(root, filters);
  if (flags.json) return printJson(items);
  return printTable(items.map((item) => ({
    id: item.id,
    status: item.status,
    queue: item.queue,
    risk: item.risk_level,
    source: item.source_id,
    title: item.title.slice(0, 60)
  })), ["id", "status", "queue", "risk", "source", "title"]);
}

async function cmdShow(root, itemId, flags) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  if (flags.json) return printJson(item);
  console.log(`# ${item.title}`);
  console.log(`id: ${item.id}`);
  console.log(`source: ${item.source_id} (${item.source_type})`);
  console.log(`status: ${item.status}`);
  console.log(`queue: ${item.queue}`);
  console.log(`risk: ${item.risk_level}`);
  console.log(`tags: ${(item.tags || []).join(", ") || "none"}`);
  console.log("");
  console.log(item.body || item.normalized_text || "");
}

async function cmdRaw(root, itemId) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  const raw = await readRaw(root, item.raw_payload_path);
  console.log(raw || "");
}

async function cmdClassify(root, itemId, flags) {
  await initStore(root);
  if (flags.new) {
    const items = await listItems(root, { status: "new" });
    const results = [];
    for (const item of items) results.push(await classifyAndSave(root, item.id, { ai: flags.ai }));
    return printJson(results.map((result) => result.item));
  }
  return printJson(await classifyAndSave(root, itemId, { ai: flags.ai }));
}

async function cmdQueue(root, itemId, queue) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  await saveItem(root, { ...item, queue, status: queue === "resolved" ? "resolved" : "queued", updated_at: isoNow() });
  console.log(`${itemId} queued to ${queue}`);
}

async function cmdTag(root, itemId, tag) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  const tags = [...new Set([...(item.tags || []), tag])];
  await saveItem(root, { ...item, tags, updated_at: isoNow() });
  console.log(`${itemId} tagged ${tag}`);
}

async function cmdAssign(root, itemId, assignee, flags) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  const field = flags.human ? "assigned_human" : "assigned_agent";
  await saveItem(root, { ...item, [field]: assignee, status: "assigned", updated_at: isoNow() });
  console.log(`${itemId} assigned to ${assignee}`);
}

async function cmdDraft(root, itemId, flags) {
  await initStore(root);
  const action = await proposeDraft(root, itemId, { body: flags.body });
  return printJson(action);
}

async function cmdActions(root, flags) {
  await initStore(root);
  const actions = await listActions(root, { status: flags.status, limit: flags.limit, offset: flags.offset });
  if (flags.json) return printJson(actions);
  return printTable(actions.map((action) => ({
    id: action.id,
    item: action.intake_item_id,
    type: action.type,
    status: action.status,
    risk: action.risk_level
  })), ["id", "item", "type", "status", "risk"]);
}

async function cmdAction(root, subcommand, actionId, flags) {
  await initStore(root);
  if (subcommand === "show") {
    const action = await loadAction(root, actionId);
    if (!action) throw new Error(`no such action: ${actionId}`);
    return printJson(action);
  }
  if (subcommand === "propose") {
    const action = makeAction({
      intake_item_id: flags.item,
      type: flags.type,
      body: flags.body || "",
      risk_level: flags.risk || "medium"
    });
    await saveAction(root, action);
    return printJson(action);
  }
  throw new Error(`unknown action command: ${subcommand}`);
}

async function cmdResolve(root, itemId) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  await saveItem(root, { ...item, status: "resolved", queue: "resolved", updated_at: isoNow() });
  await logEvent(root, "audit", { source_id: item.source_id, item_id: item.id, event_type: "item_resolved" });
  console.log(`${itemId} resolved`);
}

async function cmdBlock(root, itemId) {
  await initStore(root);
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  await saveItem(root, { ...item, status: "blocked", queue: "blocked", updated_at: isoNow() });
  await logEvent(root, "audit", { source_id: item.source_id, item_id: item.id, event_type: "item_blocked", risk_level: item.risk_level });
  console.log(`${itemId} blocked`);
}

async function cmdLearnings(root, flags) {
  await initStore(root);
  const learnings = await listLearnings(root, { status: flags.status, limit: flags.limit, offset: flags.offset });
  if (flags.json) return printJson(learnings);
  return printTable(learnings.map((learning) => ({
    id: learning.id,
    type: learning.type,
    status: learning.status,
    confidence: learning.confidence,
    title: learning.title.slice(0, 60)
  })), ["id", "type", "status", "confidence", "title"]);
}

async function cmdRules(root, subcommand, args, flags) {
  await initStore(root);
  const rules = await loadRules(root);
  if (subcommand === "list") return flags.json ? printJson(rules) : printTable(rules.map((rule) => ({ id: rule.id, risk: rule.risk_level, queue: rule.queue, description: rule.description })), ["id", "risk", "queue", "description"]);
  if (subcommand === "test" || subcommand === "explain") {
    const item = await loadItem(root, args[0]);
    if (!item) throw new Error(`no such item: ${args[0]}`);
    return console.log(explainRules(item, rules).join("\n"));
  }
  if (subcommand === "propose") {
    const item = await loadItem(root, args[0]);
    if (!item) throw new Error(`no such item: ${args[0]}`);
    const proposal = proposeRuleFromItem(item);
    const next = [...rules, proposal];
    await saveRules(root, next);
    return printJson(proposal);
  }
  if (subcommand === "approve") {
    const id = args[0];
    const next = rules.map((rule) => rule.id === id ? { ...rule, status: "approved", updated_at: isoNow() } : rule);
    await saveRules(root, next);
    return console.log(`approved ${id}`);
  }
  throw new Error(`unknown rules command: ${subcommand}`);
}

async function cmdPolicy(root, subcommand, args, flags) {
  await initStore(root);
  if (subcommand !== "preview") throw new Error("usage: intake policy preview ITEM_ID ACTION_TYPE");
  const [itemId, actionType] = args;
  if (!itemId || !actionType) throw new Error("usage: intake policy preview ITEM_ID ACTION_TYPE");
  const item = await loadItem(root, itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  const sources = await loadSources(root);
  const source = sources.find((candidate) => candidate.id === item.source_id) || null;
  const result = evaluatePolicy({
    item,
    actionType,
    policies: await loadPolicies(root),
    settings: await loadSettings(root),
    source
  });
  return flags.json ? printJson(result) : printJson(result);
}

async function cmdBackup(root, subcommand, args, flags) {
  if (subcommand === "create") {
    const result = await createBackup(root, {
      output: flags.output,
      includeSecrets: flags.includeSecrets === true,
      keep: flags.keep
    });
    return flags.json ? printJson(result) : console.log(result.path);
  }
  if (subcommand === "verify") {
    const path = args[0] || flags.path;
    if (!path) throw new Error("usage: intake backup verify BACKUP_PATH");
    const result = await verifyBackup(path);
    if (flags.json) return printJson(result);
    console.log(`${result.ok ? "OK" : "FAIL"} backup ${path} (${result.file_count} files)`);
    for (const error of result.errors || []) console.log(`FAIL ${error}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (subcommand === "restore") {
    const path = args[0] || flags.path;
    if (!path) throw new Error("usage: intake backup restore BACKUP_PATH [--target DIR] [--force]");
    const result = await restoreBackup(path, flags.target || root, { force: flags.force === true });
    return flags.json ? printJson(result) : console.log(`Restored ${result.file_count} files to ${result.restored_to}`);
  }
  throw new Error("usage: intake backup create|verify|restore");
}

async function cmdRetention(root, subcommand, flags) {
  await initStore(root);
  if (subcommand !== "apply") throw new Error("usage: intake retention apply [--raw-days N] [--logs-days N] [--dry-run]");
  const result = await applyRetention(root, {
    rawDays: flags.rawDays,
    logsDays: flags.logsDays,
    dryRun: flags.dryRun === true
  });
  return printJson(result);
}

async function cmdPurge(root, subcommand, flags) {
  await initStore(root);
  if (subcommand !== "items") throw new Error("usage: intake purge items [--item ID | --source ID | --status STATUS | --queue QUEUE | --before DATE] [--dry-run | --force]");
  const result = await purgeItems(root, {
    item: flags.item,
    source: flags.source,
    status: flags.status,
    queue: flags.queue,
    before: flags.before,
    dryRun: flags.dryRun === true,
    force: flags.force === true
  });
  return printJson(result);
}

async function cmdEval(flags) {
  const result = await runEvals();
  if (flags.json) return printJson(result);
  console.log(`Eval: ${result.ok ? "PASS" : "FAIL"} (${result.passed} passed, ${result.failed} failed)`);
  for (const row of result.results) {
    console.log(`${row.passed ? "PASS" : "FAIL"} ${row.name}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function cmdShipcheck(root) {
  await initStore(root);
  const doctor = await runDoctor(root);
  const evals = await runEvals();
  const report = { ok: doctor.ok && evals.ok, doctor, evals };
  printJson(report);
  if (!report.ok) process.exitCode = 1;
}

async function cmdAutoActions(root, subcommand) {
  await initStore(root);
  if (subcommand === "enable") return printJson(await setAutoActions(root, true));
  if (subcommand === "disable") return printJson(await setAutoActions(root, false));
  throw new Error("usage: intake auto-actions <enable|disable>");
}

async function requireSource(root, id) {
  const sources = await loadSources(root);
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`no such source: ${id}`);
  return source;
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      if (raw.includes("=")) {
        const [key, ...rest] = raw.split("=");
        flags[toCamel(key)] = rest.join("=");
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[toCamel(raw)] = next;
          i += 1;
        } else {
          flags[toCamel(raw)] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function onboardingSteps(topic) {
  if (topic === "slack") {
    return {
      topic,
      title: "Slack Events onboarding",
      steps: [
        "Create a Slack app and enable Event Subscriptions.",
        "Store the Slack signing secret in an env var such as INTAKE_SLACK_SIGNING_SECRET.",
        "Run intake source add slack --id slack-support --password-env INTAKE_SLACK_SIGNING_SECRET --path /slack/events --queue engineering.",
        "Run intake watch --source slack-support.",
        "Expose the printed localhost URL through your tunnel of choice and paste it into Slack's Request URL.",
        "Send a test event and confirm it appears in intake items."
      ]
    };
  }
  return {
    topic: "privateemail",
    title: "PrivateEmail onboarding",
    steps: [
      "Store the mailbox password in .intake/.env as INTAKE_SUPPORT_EMAIL_PASSWORD=\"mailbox-password\".",
      "Run intake source add email --id support-email --username you@example.com --password-env INTAKE_SUPPORT_EMAIL_PASSWORD --queue support.",
      "Run intake source test support-email and confirm config, IMAP, and SMTP pass.",
      "Send a harmless test email to the mailbox.",
      "Run intake sync support-email.",
      "Open intake dashboard, classify the item, draft a response, approve it, and run the draft action."
    ]
  };
}

function printSourceTest(result) {
  console.log(`Source test: ${result.ok ? "OK" : "NEEDS ATTENTION"}`);
  const checks = result.checks || {};
  for (const [name, check] of Object.entries(checks)) {
    const status = check.skipped ? "SKIP" : (check.ok ? "OK" : "FAIL");
    const detail = check.error || (check.errors || []).join("; ") || [check.host, check.port].filter(Boolean).join(":") || "";
    console.log(`${status.padEnd(4)} ${name}${detail ? ` - ${detail}` : ""}`);
  }
  for (const error of result.errors || []) console.log(`HELP ${sourceTestHelp(error)}`);
  if (!result.ok) process.exitCode = 1;
}

function sourceTestHelp(error) {
  const text = String(error || "");
  if (/missing secret env var/i.test(text)) return "Set the named env var in your shell, .env, or .intake/.env, then restart the dashboard/CLI.";
  if (/missing email username/i.test(text)) return "Set the source username to the full mailbox address.";
  if (/authentication|auth/i.test(text)) return "Verify the mailbox password and provider auth settings.";
  if (/timeout|connect/i.test(text)) return "Check host, port, firewall, VPN, and provider status.";
  if (/insecure/i.test(text)) return "Use secure IMAP/SMTP settings such as SSL ports 993 and 465.";
  return text;
}

function help() {
  console.log([
    "Kujo Intake - local-first source-agnostic inbound work intake",
    "",
    "Usage:",
    "  intake init",
    "  intake onboarding [privateemail|slack]",
    "  intake source add <manual|file|email|webhook|slack> [--name NAME] [--password-env ENV | --keychain-service SERVICE --keychain-account ACCOUNT]",
    "  intake source list|test|enable|disable|remove|clone",
    "  intake config export|import",
    "  intake templates list|show TEMPLATE_ID",
    "  intake item create --title TEXT --body TEXT [--queue QUEUE]",
    "  intake sync [SOURCE_ID]",
    "  intake watch",
    "  intake items [--queue QUEUE] [--source SOURCE_ID] [--tag TAG] [--risk high] [--status needs_review] [--limit N] [--offset N]",
    "  intake show ITEM_ID",
    "  intake raw ITEM_ID",
    "  intake classify ITEM_ID [--ai]",
    "  intake classify --new",
    "  intake queue ITEM_ID QUEUE",
    "  intake tag ITEM_ID TAG",
    "  intake assign ITEM_ID AGENT_OR_HUMAN [--human]",
    "  intake draft ITEM_ID",
    "  intake actions",
    "  intake action show ACTION_ID",
    "  intake approve ACTION_ID",
    "  intake reject ACTION_ID",
    "  intake run ACTION_ID",
    "  intake resolve ITEM_ID",
    "  intake block ITEM_ID",
    "  intake learn ITEM_ID",
    "  intake learnings",
    "  intake strata daily",
    "  intake totalrecall export",
    "  intake rules list|test|explain|propose|approve",
    "  intake policy preview ITEM_ID ACTION_TYPE",
    "  intake backup create [--output PATH] [--include-secrets] [--keep N]",
    "  intake backup verify BACKUP_PATH",
    "  intake backup restore BACKUP_PATH [--target DIR] [--force]",
    "  intake retention apply [--raw-days N] [--logs-days N] [--dry-run]",
    "  intake purge items [--item ID | --source ID | --status STATUS | --queue QUEUE | --before DATE] [--dry-run | --force]",
    "  intake doctor",
    "  intake dashboard [--port 8787] [--token TOKEN]",
    "  intake demo seed email",
    "  intake demo clear",
    "  intake eval run",
    "  intake shipcheck"
  ].join("\n"));
}

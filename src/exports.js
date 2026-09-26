import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dateOnly, writeJsonAtomic, writeTextAtomic } from "./util.js";
import { listItems, listLearnings, loadSettings, logEvent, saveLearning } from "./storage.js";

export async function exportStrataDaily(root, options = {}) {
  const day = options.date || dateOnly();
  const settings = await loadSettings(root);
  const items = await listItems(root);
  const learnings = await listLearnings(root);
  const dayItems = items.filter((item) => String(item.received_at || item.created_at || "").startsWith(day));
  const path = options.output || join(settings.strata_import_dir || join(root, "strata", "daily"), `intake-learnings-${day}.md`);
  await mkdir(dirname(path), { recursive: true });
  const md = renderStrataNote(day, dayItems, learnings);
  await writeTextAtomic(path, md);
  for (const learning of learnings) {
    if (!learning.exported_to_strata) {
      await saveLearning(root, { ...learning, exported_to_strata: true, status: learning.status === "accepted" ? "exported" : learning.status });
    }
  }
  await logEvent(root, "audit", { event_type: "strata_daily_export", output_refs: [path] });
  return path;
}

export async function exportTotalRecall(root, options = {}) {
  const day = options.date || dateOnly();
  const settings = await loadSettings(root);
  const items = await listItems(root);
  const learnings = await listLearnings(root);
  const exportDir = settings.totalrecall_export_dir || join(root, "totalrecall", "exports");
  const path = options.output || join(exportDir, `intake-totalrecall-${day}.json`);
  const payload = {
    schema: "kujo.intake.totalrecall.export.v1",
    exported_at: new Date().toISOString(),
    records: items
      .filter((item) => ["resolved", "ignored", "blocked"].includes(item.status) || item.learning_flags?.length)
      .map((item) => ({
        item_id: item.id,
        source_id: item.source_id,
        source_type: item.source_type,
        title: item.title,
        summary: item.ai_summary || item.normalized_text.slice(0, 500),
        outcome: item.status,
        queue: item.queue,
        tags: item.tags,
        risk_level: item.risk_level,
        received_at: item.received_at,
        updated_at: item.updated_at
      })),
    learnings: learnings
      .filter((learning) => ["accepted", "exported", "reviewed", "proposed"].includes(learning.status))
      .map((learning) => ({
        learning_id: learning.id,
        type: learning.type,
        title: learning.title,
        summary: learning.summary,
        evidence: learning.evidence,
        status: learning.status,
        confidence: learning.confidence
      }))
  };
  await writeJsonAtomic(path, payload);
  await logEvent(root, "audit", { event_type: "totalrecall_export", output_refs: [path] });
  return path;
}

function renderStrataNote(day, items, learnings) {
  const by = (field) => countBy(items, field);
  const tagCounts = Object.create(null);
  for (const item of items) {
    for (const tag of item.tags || []) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  return [
    `# Intake Learnings - ${day}`,
    "",
    "## Executive summary",
    `${items.length} inbound items were captured. ${learnings.length} learning records are available for review.`,
    "",
    "## Inbound volume by source",
    renderCounts(by("source_type")),
    "",
    "## Volume by queue",
    renderCounts(by("queue")),
    "",
    "## Volume by tag/category",
    renderCounts(tagCounts),
    "",
    "## Repeated questions",
    renderLearningList(learnings, "faq_candidate"),
    "",
    "## Possible release regressions",
    renderTaggedItems(items, "bug-report"),
    "",
    "## FAQ candidates",
    renderTaggedItems(items, "faq-candidate"),
    "",
    "## Docs updates needed",
    renderTaggedItems(items, "docs-needed"),
    "",
    "## Support friction",
    renderQueueItems(items, "support"),
    "",
    "## Sales/client signals",
    renderQueueItems(items, "sales"),
    "",
    "## Product feedback",
    renderTaggedItems(items, "product-feedback"),
    "",
    "## Agent mistakes",
    renderLearningList(learnings, "agent_mistake"),
    "",
    "## Human review bottlenecks",
    renderQueueItems(items, "human-review"),
    "",
    "## Auto-action performance",
    "Auto-actions are disabled by default; review audit logs for any approved executions.",
    "",
    "## Suggested rules",
    renderLearningList(learnings, "rule_suggestion"),
    "",
    "## Suggested knowledge updates",
    renderLearningList(learnings, "item_learning"),
    "",
    "## Follow-up tasks",
    "- Review high-risk and critical items before any outbound action.",
    ""
  ].join("\n");
}

function countBy(items, field) {
  const counts = Object.create(null);
  for (const item of items) counts[item[field] || "unknown"] = (counts[item[field] || "unknown"] || 0) + 1;
  return counts;
}

function renderCounts(counts) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return rows.length ? rows.map(([key, value]) => `- ${key}: ${value}`).join("\n") : "- none";
}

function renderTaggedItems(items, tag) {
  const rows = items.filter((item) => item.tags?.includes(tag));
  return rows.length ? rows.map((item) => `- ${item.id}: ${item.title}`).join("\n") : "- none";
}

function renderQueueItems(items, queue) {
  const rows = items.filter((item) => item.queue === queue);
  return rows.length ? rows.map((item) => `- ${item.id}: ${item.title}`).join("\n") : "- none";
}

function renderLearningList(learnings, type) {
  const rows = learnings.filter((learning) => learning.type === type);
  return rows.length ? rows.map((learning) => `- ${learning.title}: ${learning.summary}`).join("\n") : "- none";
}

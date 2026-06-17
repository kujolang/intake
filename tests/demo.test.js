import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearDemo, seedEmailDemo } from "../src/demo.js";
import { initStore, listActions, listItems, listLearnings, loadSources } from "../src/storage.js";
import { approveAction, runAction } from "../src/workflow.js";

test("email demo seed creates and clears only demo records", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-demo-test-"));
  try {
    await initStore(root);
    const seeded = await seedEmailDemo(root);
    assert.equal(seeded.seed_id, "demo-email-interaction-v1");

    const sources = await loadSources(root);
    const items = await listItems(root);
    const actions = await listActions(root);
    const learnings = await listLearnings(root);

    assert.ok(sources.some((source) => source.id === seeded.source_id));
    assert.ok(items.some((item) => item.id === seeded.item_id && item.source_type === "email"));
    assert.ok(actions.some((action) => action.id === seeded.action_id && action.status === "needs_review"));
    assert.ok(learnings.some((learning) => learning.id === seeded.learning_id));

    await approveAction(root, seeded.action_id, "test");
    const executed = await runAction(root, seeded.action_id);
    assert.equal(executed.status, "executed");
    assert.equal(executed.result.demo, true);

    const cleared = await clearDemo(root);
    assert.equal(cleared.seed_id, seeded.seed_id);
    assert.equal((await loadSources(root)).some((source) => source.id === seeded.source_id), false);
    assert.equal((await listItems(root)).some((item) => item.id === seeded.item_id), false);
    assert.equal((await listActions(root)).some((action) => action.id === seeded.action_id), false);
    assert.equal((await listLearnings(root)).some((learning) => learning.id === seeded.learning_id), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

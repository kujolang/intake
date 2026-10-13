import test from "node:test";
import assert from "node:assert/strict";
import { classifyWithAi, resolveAiProvider, validateOpenAiCompatibleBaseUrl } from "../src/ai.js";
import { makeItem } from "../src/models.js";

test("AI provider presets resolve OpenAI-compatible settings", () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const provider = resolveAiProvider({
    ai_enabled: true,
    ai_provider: "openrouter",
    ai_model: "anthropic/claude-3.5-sonnet"
  });

  assert.equal(provider.ok, true);
  assert.equal(provider.base_url, "https://openrouter.ai/api/v1");
  assert.equal(provider.api_key_env, "OPENROUTER_API_KEY");
  assert.equal(provider.model, "anthropic/claude-3.5-sonnet");
  delete process.env.OPENROUTER_API_KEY;
});

test("AI provider rejects unsafe custom base URLs", () => {
  assert.equal(validateOpenAiCompatibleBaseUrl("https://api.example.com/v1").ok, true);
  assert.equal(validateOpenAiCompatibleBaseUrl("https://user:pass@example.com/v1").ok, false);
  assert.equal(validateOpenAiCompatibleBaseUrl("https://api.example.com/v1?token=secret").ok, false);
  assert.equal(validateOpenAiCompatibleBaseUrl("http://api.example.com/v1").ok, false);
});

test("AI classification posts normalized chat completion payload", async () => {
  const previousFetch = globalThis.fetch;
  process.env.INTAKE_TEST_AI_KEY = "test-key";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://llm.example.test/v1/chat/completions");
    assert.equal(options.headers.authorization, "Bearer test-key");
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "custom-model");
    assert.equal(payload.response_format.type, "json_object");
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                summary: "Refund request",
                suggested_category: "billing",
                suggested_tags: ["billing"],
                confidence: 0.9,
                risk_level: "medium"
              })
            }
          }]
        };
      }
    };
  };

  try {
    const item = makeItem({ title: "Refund", body: "Please refund me." });
    const result = await classifyWithAi(item, {
      ai_enabled: true,
      ai_provider: "openai-compatible",
      ai_base_url: "https://llm.example.test/v1",
      ai_api_key_env: "INTAKE_TEST_AI_KEY",
      ai_model: "custom-model"
    });
    assert.equal(result.summary, "Refund request");
    assert.equal(result.confidence, 0.9);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.INTAKE_TEST_AI_KEY;
  }
});

test("AI classification treats invalid model shapes as unavailable", async (t) => {
  process.env.INTAKE_SHAPE_TEST_KEY = "fixture";
  t.after(() => delete process.env.INTAKE_SHAPE_TEST_KEY);
  const item = makeItem({ title: "Question", body: "Please help" });
  const settings = { ai_enabled: true, ai_provider: "openai-compatible", ai_base_url: "https://example.test", ai_api_key_env: "INTAKE_SHAPE_TEST_KEY" };
  let content;
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content } }] }));
  for (const value of [null, [], "text", 42, { summary: {} }, { suggested_tags: [{}] }, { confidence: 2 }, { human_review_required: "false" }]) {
    content = JSON.stringify(value);
    const result = await classifyWithAi(item, settings);
    assert.equal(result.human_review_required, true, content);
    assert.equal(result.auto_action_allowed, false, content);
    assert.equal(typeof result.summary, "string", content);
  }
  content = JSON.stringify({ summary: "Valid partial result", confidence: 0, suggested_tags: ["support"] });
  assert.deepEqual(await classifyWithAi(item, settings), JSON.parse(content));
});

test("item models preserve explicit zero AI confidence", () => {
  assert.equal(makeItem({ title: "Low confidence", ai_confidence: 0 }).ai_confidence, 0);
});

test("AI validates response limits before fetch and cancels unsuccessful bodies", async (t) => {
  process.env.INTAKE_SHAPE_TEST_KEY = "fixture";
  t.after(() => delete process.env.INTAKE_SHAPE_TEST_KEY);
  const settings = { ai_enabled: true, ai_provider: "openai-compatible", ai_base_url: "https://example.test", ai_api_key_env: "INTAKE_SHAPE_TEST_KEY" };
  let calls = 0;
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 });
  });
  const item = makeItem({ title: "Question" });
  await assert.rejects(() => classifyWithAi(item, { ...settings, ai_max_response_bytes: -1 }), /ai_max_response_bytes/);
  assert.equal(calls, 0);
  assert.equal((await classifyWithAi(item, settings)).human_review_required, true);
  assert.equal(cancelled, true);
});

test("AI fallback does not claim that attempted provider requests never occurred", async (t) => {
  process.env.INTAKE_FALLBACK_REVIEW_KEY = "fixture";
  t.after(() => delete process.env.INTAKE_FALLBACK_REVIEW_KEY);
  const settings = { ai_enabled: true, ai_provider: "openai-compatible", ai_base_url: "https://example.test", ai_api_key_env: "INTAKE_FALLBACK_REVIEW_KEY" };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("unavailable", { status: 503 })
    : Response.json({ choices: [{ message: { content: "[]" } }] }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await classifyWithAi(makeItem({ title: "Question" }), settings);
    assert.equal(result.human_review_required, true);
    assert.equal(result.auto_action_allowed, false);
    assert.equal(result.assumptions.includes("No provider call was made."), false);
  }
  assert.equal(calls, 2);
});

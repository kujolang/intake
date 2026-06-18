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

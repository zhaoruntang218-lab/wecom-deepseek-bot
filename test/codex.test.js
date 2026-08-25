import test from "node:test";
import assert from "node:assert/strict";
import { askCodex } from "../src/codex.js";

test("Codex client sends the configured model and reasoning effort", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const answer = await askCodex({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "gpt-5.6-terra",
      reasoningEffort: "xhigh",
      systemPrompt: "system",
      history: [],
      question: "hello",
    });
    assert.equal(answer, "answer");
    assert.equal(request.url, "https://example.test/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.equal(request.body.model, "gpt-5.6-terra");
    assert.equal(request.body.reasoning_effort, "xhigh");
    assert.equal(request.body.messages.at(-1).content, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Codex client reports provider errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "unsupported model" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      askCodex({ apiKey: "test-key", baseUrl: "https://example.test/v1", question: "hello", history: [], systemPrompt: "" }),
      /unsupported model/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

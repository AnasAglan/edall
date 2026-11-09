import assert from "node:assert/strict";
import { runAssistantModel, GEMINI_MODEL } from "../workers/edall-assistant/provider-router.js";

const model = "@cf/zai-org/glm-4.7-flash";
const messages = [
  { role: "system", content: "أنت مساعد ED-ALL." },
  { role: "user", content: "تذكّر الدورة التي تحدثنا عنها سابقًا." }
];
const tools = [{
  type: "function",
  function: {
    name: "update_course",
    description: "Update an existing course",
    parameters: { type: "object", properties: { course_id: { type: "string" } } }
  }
}];
const options = {
  messages,
  tools,
  tool_choice: "auto",
  reasoning_effort: "low",
  chat_template_kwargs: { enable_thinking: false, clear_thinking: true },
  max_completion_tokens: 72
};

const originalFetch = globalThis.fetch;
const sequence = [];

try {
  // Workers AI succeeds: Gemini must not be called.
  globalThis.fetch = async () => {
    sequence.push("unexpected-gemini");
    throw new Error("Gemini must not be called when Workers AI succeeds.");
  };
  let receivedOptions;
  const primaryResult = await runAssistantModel({
    AI: {
      run: async (selectedModel, received) => {
        sequence.push("workers-ai");
        assert.equal(selectedModel, model);
        receivedOptions = received;
        return { choices: [{ message: { content: "Workers AI primary" } }] };
      }
    },
    GEMINI_API_KEY: "test-only-key"
  }, model, options);

  assert.equal(primaryResult.choices[0].message.content, "Workers AI primary");
  assert.equal(receivedOptions, options);
  assert.deepEqual(sequence, ["workers-ai"]);

  // Workers AI quota/error: Gemini receives the same history and tool schemas.
  sequence.length = 0;
  let geminiPayload;
  globalThis.fetch = async (url, init) => {
    sequence.push("gemini");
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(init.method, "POST");
    geminiPayload = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Gemini fallback" } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const fallbackResult = await runAssistantModel({
    AI: {
      run: async (selectedModel, received) => {
        sequence.push("workers-ai");
        assert.equal(selectedModel, model);
        assert.equal(received, options);
        throw new Error("Workers AI quota exceeded: daily neurons limit");
      }
    },
    GEMINI_API_KEY: "test-only-key"
  }, model, options);

  assert.equal(fallbackResult.choices[0].message.content, "Gemini fallback");
  assert.deepEqual(sequence, ["workers-ai", "gemini"]);
  assert.deepEqual(geminiPayload.messages, messages);
  assert.deepEqual(geminiPayload.tools, tools);
  assert.equal(geminiPayload.tool_choice, "auto");
  assert.equal(geminiPayload.model, GEMINI_MODEL);
  assert.equal(geminiPayload.max_tokens, 72);
  assert.equal("max_completion_tokens" in geminiPayload, false);
  assert.equal("reasoning_effort" in geminiPayload, false);
  assert.equal("chat_template_kwargs" in geminiPayload, false);

  // Streaming fallback returns the readable response body, not a Response wrapper.
  const streamOptions = { messages, stream: true, max_tokens: 96 };
  const responseStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
      controller.close();
    }
  });
  globalThis.fetch = async () => new Response(responseStream, { status: 200 });
  const streamed = await runAssistantModel({
    AI: { run: async () => { throw new Error("Workers AI quota exceeded"); } },
    GEMINI_API_KEY: "test-only-key"
  }, model, streamOptions);
  assert.equal(typeof streamed.getReader, "function");

  // If both providers fail, return a typed, explicit provider failure.
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: "Gemini temporarily unavailable" } }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
  await assert.rejects(
    () => runAssistantModel({
      AI: { run: async () => { throw new Error("Workers AI exhausted quota"); } },
      GEMINI_API_KEY: "test-only-key"
    }, model, options),
    error => error.code === "ALL_AI_PROVIDERS_FAILED" &&
      error.message.includes("Workers AI exhausted quota") &&
      error.message.includes("Gemini API returned 503")
  );

  // Missing Gemini secret is reported clearly, while the Workers AI result remains first priority.
  await assert.rejects(
    () => runAssistantModel({
      AI: { run: async () => { throw new Error("Workers AI unavailable"); } }
    }, model, options),
    error => error.code === "GEMINI_FALLBACK_NOT_CONFIGURED"
  );

  console.log("Assistant provider routing tests passed: Workers AI primary, Gemini context/tool fallback, streaming, and dual-provider failure.");
} finally {
  globalThis.fetch = originalFetch;
}

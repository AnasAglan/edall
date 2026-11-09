import test from "node:test";
import assert from "node:assert/strict";
import { runAssistantModel } from "./index.js";

const MODEL = "@cf/zai-org/glm-4.7-flash";
const encoder = new TextEncoder();

function completion(content) {
  return {
    id: "test-completion",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop"
    }]
  };
}

function streamOf(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const item = await reader.read();
    if (item.done) return text;
    text += decoder.decode(item.value, { stream: true });
  }
}

test("Workers AI is primary and Gemini is not called when it succeeds", async () => {
  const calls = [];
  const result = await runAssistantModel({
    AI: {
      run: async (model, options) => {
        calls.push({ model, options });
        return completion("Workers AI answered");
      }
    },
    GEMINI_API_KEY: "test-key"
  }, MODEL, { messages: [{ role: "user", content: "hello" }] }, async () => {
    throw new Error("Gemini must not be called after a successful Workers AI response.");
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, MODEL);
  assert.equal(result.choices[0].message.content, "Workers AI answered");
});

test("Workers AI remains usable even when the Gemini secret is absent", async () => {
  const result = await runAssistantModel({
    AI: { run: async () => completion("Primary provider is independent of Gemini.") }
  }, MODEL, { messages: [{ role: "user", content: "hello" }] }, async () => {
    throw new Error("Gemini must not be called.");
  });

  assert.match(result.choices[0].message.content, /independent of Gemini/);
});

test("Gemini fallback receives the exact conversation and tool-call transcript", async () => {
  const messages = [
    { role: "system", content: "ED-ALL system prompt" },
    { role: "user", content: "Create a course and then add a lesson." },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-create-course",
        type: "function",
        function: { name: "create_course", arguments: "{\"title\":\"Mathematics\"}" }
      }]
    },
    {
      role: "tool",
      tool_call_id: "call-create-course",
      content: "{\"created\":true,\"verified\":true,\"course_id\":\"course-1\"}"
    },
    { role: "user", content: "Add the first lesson to that course." }
  ];
  const tools = [{
    type: "function",
    function: { name: "create_lesson", parameters: { type: "object", properties: {} } }
  }];
  let requestBody;
  const result = await runAssistantModel({
    AI: {
      run: async () => {
        const error = new Error("Daily free allocation exhausted");
        error.status = 429;
        error.code = 3036;
        throw error;
      }
    },
    GEMINI_API_KEY: "test-gemini-secret"
  }, MODEL, {
    messages,
    tools,
    tool_choice: "auto",
    max_completion_tokens: 2400,
    reasoning_effort: "low",
    chat_template_kwargs: { enable_thinking: false }
  }, async (url, init) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test-gemini-secret");
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify(completion("Gemini continued the same conversation.")), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  assert.deepEqual(requestBody.messages, messages);
  assert.deepEqual(requestBody.tools, tools);
  assert.equal(requestBody.tool_choice, "auto");
  assert.equal(requestBody.model, "gemini-3.8-flash");
  assert.equal(requestBody.max_tokens, 2400);
  assert.equal("chat_template_kwargs" in requestBody, false);
  assert.equal(result.choices[0].message.content, "Gemini continued the same conversation.");
});

test("a reasoning-only or truncated Workers AI result falls back to Gemini", async () => {
  const truncated = {
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "internal reasoning without user-visible text",
        tool_calls: []
      },
      finish_reason: "length"
    }]
  };
  const result = await runAssistantModel({
    AI: { run: async () => truncated },
    GEMINI_API_KEY: "test-gemini-secret"
  }, MODEL, {
    messages: [{ role: "user", content: "Create the course." }],
    max_completion_tokens: 16,
    chat_template_kwargs: { enable_thinking: false }
  }, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gemini-3.6-flash");
    assert.equal(body.messages[0].content, "Create the course.");
    return new Response(JSON.stringify(completion("Gemini returned a visible answer.")), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  assert.equal(result.choices[0].message.content, "Gemini returned a visible answer.");
});

test("a valid tool call with null text content stays on Workers AI", async () => {
  const toolReply = {
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-create-course",
          type: "function",
          function: { name: "create_course", arguments: "{\"title\":\"Mathematics\"}" }
        }]
      },
      finish_reason: "tool_calls"
    }]
  };
  const result = await runAssistantModel({
    AI: { run: async () => toolReply },
    GEMINI_API_KEY: "test-gemini-secret"
  }, MODEL, { messages: [{ role: "user", content: "Create a course." }] }, async () => {
    throw new Error("A valid tool call must not trigger Gemini fallback.");
  });

  assert.equal(result.choices[0].message.tool_calls[0].function.name, "create_course");
});

test("Gemini fallback also works when Workers AI streaming fails before its first chunk", async () => {
  const brokenStream = new ReadableStream({
    start(controller) {
      controller.error(new Error("Workers AI stream failed before producing output."));
    }
  });
  const sse = 'data: {"choices":[{"delta":{"content":"Gemini stream"}}]}\\n\\ndata: [DONE]\\n\\n';

  const stream = await runAssistantModel({
    AI: { run: async () => brokenStream },
    GEMINI_API_KEY: "test-gemini-secret"
  }, MODEL, {
    stream: true,
    messages: [{ role: "user", content: "continue" }]
  }, async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    return new Response(streamOf(sse), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  });

  assert.equal(await readAll(stream), sse);
});

test("a successful Workers AI stream is passed through without switching providers", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"primary stream"}}]}\\n\\ndata: [DONE]\\n\\n';
  const stream = await runAssistantModel({
    AI: { run: async (_model, options) => {
      assert.equal(options.stream, true);
      return streamOf(sse);
    }}
  }, MODEL, { stream: true, messages: [{ role: "user", content: "hello" }] }, async () => {
    throw new Error("Gemini must not be called.");
  });

  assert.equal(await readAll(stream), sse);
});

test("missing Gemini secret reports a clear error only after Workers AI fails", async () => {
  await assert.rejects(
    runAssistantModel({
      AI: { run: async () => { throw new Error("Workers AI quota exhausted"); } }
    }, MODEL, { messages: [{ role: "user", content: "hello" }] }, async () => {
      throw new Error("Gemini fetch must not be called without a secret.");
    }),
    /GEMINI_API_KEY is missing/
  );
});

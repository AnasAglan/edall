const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const GEMINI_MODEL = "gemini-2.5-flash";

function errorMessage(error) {
  return String(error?.message || error || "Unknown provider error").slice(0, 500);
}

async function runGeminiFallback(env, options = {}) {
  const {
    reasoning_effort,
    chat_template_kwargs,
    max_completion_tokens,
    ...compatibleOptions
  } = options;

  const payload = {
    ...compatibleOptions,
    model: GEMINI_MODEL,
    ...(max_completion_tokens && !compatibleOptions.max_tokens
      ? { max_tokens: max_completion_tokens }
      : {})
  };

  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.GEMINI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error("Gemini API returned " + response.status + ": " + detail);
    error.status = response.status;
    throw error;
  }

  if (compatibleOptions.stream === true) {
    if (!response.body) throw new Error("Gemini returned an empty streaming response.");
    console.info("ED-ALL AI provider selected: Gemini fallback", GEMINI_MODEL, "streaming");
    return response.body;
  }

  const result = await response.json();
  if (!result || !Array.isArray(result.choices) || result.choices.length === 0) {
    throw new Error("Gemini returned an invalid or empty OpenAI-compatible response.");
  }

  console.info("ED-ALL AI provider selected: Gemini fallback", GEMINI_MODEL, "non-streaming");
  return result;
}

/**
 * Shared model router for every ED-ALL assistant operation:
 * scope/write classification, tool selection, vision, and final streamed replies.
 * Both providers receive the same conversation and tool definitions. Workers AI
 * is primary; Gemini is attempted only when Workers AI cannot start/complete the
 * inference request. A partially emitted stream cannot be transparently replayed.
 */
export async function runAssistantModel(env, workersAiModel, options = {}) {
  let workersAiError;

  if (env?.AI && typeof env.AI.run === "function") {
    try {
      const result = await env.AI.run(workersAiModel, options);

      if (options.stream === true) {
        const stream = result instanceof Response ? result.body : result;
        if (!stream || typeof stream.getReader !== "function") {
          throw new Error("Workers AI returned an invalid or empty response stream.");
        }
        console.info("ED-ALL AI provider selected: Workers AI", workersAiModel, "streaming");
        return stream;
      }

      if (!result || !Array.isArray(result.choices) || result.choices.length === 0) {
        throw new Error("Workers AI returned an invalid or empty chat-completion response.");
      }

      console.info("ED-ALL AI provider selected: Workers AI", workersAiModel, "non-streaming");
      return result;
    } catch (error) {
      workersAiError = error;
      console.warn(
        "ED-ALL Workers AI primary failed; switching to Gemini:",
        errorMessage(error)
      );
    }
  } else {
    workersAiError = new Error("Workers AI binding is not configured.");
    console.warn("ED-ALL Workers AI primary is unavailable; switching to Gemini.");
  }

  if (typeof env?.GEMINI_API_KEY !== "string" || !env.GEMINI_API_KEY.trim()) {
    const error = new Error(
      "Workers AI primary failed and GEMINI_API_KEY is not configured. Workers AI: " +
      errorMessage(workersAiError)
    );
    error.code = "GEMINI_FALLBACK_NOT_CONFIGURED";
    error.workersAIError = workersAiError;
    throw error;
  }

  try {
    return await runGeminiFallback(env, options);
  } catch (geminiError) {
    console.error("ED-ALL Gemini fallback failed:", errorMessage(geminiError));
    const error = new Error(
      "Both ED-ALL AI providers failed. Workers AI: " +
      errorMessage(workersAiError) +
      "; Gemini: " +
      errorMessage(geminiError)
    );
    error.code = "ALL_AI_PROVIDERS_FAILED";
    error.workersAIError = workersAiError;
    error.geminiError = geminiError;
    throw error;
  }
}

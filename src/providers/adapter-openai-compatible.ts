// OpenAI-Compatible Adapter — Unified API Connector
//
// This is a refactored version of the original openrouter_adapter.ts.
// The adapter works against ANY OpenAI-compatible /chat/completions endpoint —
// OpenRouter, OpenAI, local LM Studio, Ollama, llama.cpp, vLLM, LocalAI.
//
// The gateway.ts module configures this adapter per-provider with the
// appropriate base URL and API key.

export {
    configure,
    complete,
    completeStream,
    selectModel,
} from "./openrouter-adapter.ts";

// Re-export the configure function with a more descriptive name for the gateway.
export { configure as configureOpenRouter } from "./openrouter-adapter.ts";

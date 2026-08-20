// Provider Gateway — Multi-Provider Routing Layer
// Routes completion requests to OpenAI, Anthropic, or Ollama based on
// the model name. Uses the existing OpenRouter-compatible wire format
// (OpenAI /chat/completions) for all providers — OpenAI is native,
// Anthropic and Ollama are proxied through providers that translate
// to/from the OpenAI chat format.

import {
    complete as openrouterComplete,
    completeStream as openrouterCompleteStream,
    configure as configureOpenRouter,
} from "./adapter-openai-compatible.ts";
import { getAllFingerprints as getStaticFingerprints } from "./fingerprints.ts";
import type {
    CompletionRequest,
    CompletionResponse,
} from "../core/types.ts";

// ─── Provider Detection ───────────────────────────────────────────────────────

/**
 * Determine which gateway provider should handle a given model ID.
 * The decision is based on the model string prefix.
 *
 * - `openai/gpt-4o` or `gpt-4o` → OpenAI-compatible
 * - `anthropic/claude-3-5-sonnet` → Anthropic (via OpenRouter proxy)
 * - `ollama/llama3` → Ollama (local)
 * - Unprefixed models → treated as direct OpenAI
 *
 * @param model - Full model identifier (may include provider prefix)
 * @returns The resolved provider name
 */
export function detectProvider(model: string): GatewayProviderName {
    const lower = model.toLowerCase();
    // Anthropic Claude: Claude 3, 3.5, 3.7, 4 and later (including suffix dates)
    if (
        lower.startsWith("anthropic/") ||
        lower.startsWith("claude-") ||
        lower.match(/^claude-4/i) ||
        lower.match(/^claude-3\.[57]/i) ||
        lower.match(/^claude-3/i)
    ) {
        return "anthropic";
    }
    // OpenAI: GPT-4, o1, o3, o3-pro, gpt-4.5, gpt-5
    if (
        lower.startsWith("openai/") ||
        lower.startsWith("gpt-") ||
        lower.startsWith("o1") ||
        lower.startsWith("o3") ||
        lower.startsWith("gpt-4.5") ||
        lower.startsWith("gpt-5")
    ) {
        return "openai";
    }
    // Ollama / local: llama 3/4, mistral, mixtral, qwen, phi, etc.
    if (
        lower.startsWith("ollama/") ||
        lower.startsWith("llama") ||
        lower.startsWith("mistral") ||
        lower.startsWith("mixtral")
    ) {
        return "ollama";
    }
    // Unprefixed models are treated as direct OpenAI
    return "openai";
}

/**
 * Extract the bare model name by stripping provider prefixes.
 * e.g., "openai/gpt-4o" → "gpt-4o", "anthropic/claude-3-5-sonnet-20241022" → "claude-3-5-sonnet-20241022"
 */
export function stripProviderPrefix(model: string): string {
    const lower = model.toLowerCase();
    for (const prefix of ["openai/", "anthropic/", "ollama/", "google/", "meta/", "deepseek/"]) {
        if (lower.startsWith(prefix)) {
            return model.slice(prefix.length);
        }
    }
    return model;
}

// ─── Provider Configurations ──────────────────────────────────────────────────

/**
 * Configuration for a single gateway provider.
 * Each provider has its own base URL, auth strategy, and default settings.
 */
export interface ProviderConfig {
    /** The provider name (used for routing). */
    name: GatewayProviderName;
    /** Base URL for the provider's chat completions API. */
    baseUrl: string;
    /** Environment variable that holds the API key. */
    envKey: string;
    /** Whether the provider requires authentication. */
    requiresAuth: boolean;
    /** Default headers to send with every request. */
    defaultHeaders: Record<string, string>;
}

/**
 * Built-in provider configurations with their default settings.
 *
 * - **openai**: Direct to OpenAI's API (api.openai.com/v1)
 * - **anthropic**: Via OpenRouter proxy (anthropic/claude-* models)
 * - **ollama**: Local Ollama instance (localhost:11434/v1)
 * - **openrouter**: Fallback for any model not matched above
 */
export const PROVIDER_CONFIGS: Record<GatewayProviderName, ProviderConfig> = {
    openai: {
        name: "openai",
        baseUrl: "https://api.openai.com/v1",
        envKey: "OPENAI_API_KEY",
        requiresAuth: true,
        defaultHeaders: {
            "HTTP-Referer": "https://llm-guardian.dev",
            "X-Title": "LLM Guardian",
        },
    },
    anthropic: {
        name: "anthropic",
        // Anthropic doesn't natively support the OpenAI /chat/completions format.
        // Route through OpenRouter which translates Anthropic models to
        // the OpenAI-compatible format for us.
        baseUrl: "https://openrouter.ai/api/v1",
        envKey: "OPENROUTER_API_KEY",
        requiresAuth: true,
        defaultHeaders: {
            "HTTP-Referer": "https://llm-guardian.dev",
            "X-Title": "LLM Guardian",
        },
    },
    ollama: {
        name: "ollama",
        // Ollama has a native OpenAI-compatible endpoint.
        baseUrl: "http://localhost:11434/v1",
        envKey: "OLLAMA_API_KEY",
        requiresAuth: false,
        defaultHeaders: {},
    },
    openrouter: {
        name: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        envKey: "OPENROUTER_API_KEY",
        requiresAuth: true,
        defaultHeaders: {
            "HTTP-Referer": "https://llm-guardian.dev",
            "X-Title": "LLM Guardian",
        },
    },
};

export type GatewayProviderName = "openai" | "anthropic" | "ollama" | "openrouter";

// ─── Gateway ──────────────────────────────────────────────────────────────────

/**
 * A provider gateway that routes LLM completion requests to the correct
 * backend based on the model name.
 *
 * The gateway inspects the model string (e.g., `"openai/gpt-4o"`,
 * `"anthropic/claude-3-5-sonnet-20241022"`, or `"gpt-4o"`) and dispatches
 * to the matching provider adapter. All adapters use the OpenAI-compatible
 * /chat/completions wire format, so the response is unified.
 *
 * @example Configure and route a request
 * ```ts
 * const gateway = new ProviderGateway({
 *   openai: { apiKey: "sk-..." },
 *   anthropic: { apiKey: "or-..." },
 *   ollama: { baseUrl: "http://localhost:11434/v1" },
 * });
 *
 * const response = await gateway.complete({
 *   model: "openai/gpt-4o",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 */
export class ProviderGateway {
    /** Per-provider API keys. Falls back to environment variables. */
    private apiKeys: Partial<Record<GatewayProviderName, string>> = {};
    /** Override base URLs per provider (useful for local proxies). */
    private baseUrls: Partial<Record<GatewayProviderName, string>> = {};
    /**
     * When true, model IDs are sent to the provider unchanged — no
     * provider-prefix stripping. Set by `pinToEndpoint` so a custom
     * OpenAI-compatible server receives the exact ID it reports at
     * `/v1/models` (e.g. `google/gemma-4-e2b`), not a stripped variant.
     */
    private pinModel = false;

    /**
     * @param config - Optional initial configuration: API keys and base URLs.
     */
    constructor(config?: {
        apiKeys?: Partial<Record<GatewayProviderName, string>>;
        baseUrls?: Partial<Record<GatewayProviderName, string>>;
    }) {
        if (config?.apiKeys) {
            this.apiKeys = { ...config.apiKeys };
        }
        if (config?.baseUrls) {
            this.baseUrls = { ...config.baseUrls };
        }
    }

    /**
     * Set an API key for a specific provider.
     */
    setApiKey(provider: GatewayProviderName, key: string): void {
        this.apiKeys[provider] = key;
    }

    /**
     * Set a base URL override for a specific provider.
     */
    setBaseUrl(provider: GatewayProviderName, url: string): void {
        this.baseUrls[provider] = url;
    }

    /**
     * Pin every request to a single OpenAI-compatible endpoint.
     *
     * All four provider routes get the same base URL (and key, if given), and
     * model IDs are sent unchanged — so whatever model the user picks, the
     * request lands on this endpoint with the exact ID it advertises at
     * `/v1/models`. This is how the TUI talks to LM Studio, Ollama, llama.cpp,
     * vLLM, or any self-hosted OpenAI-compatible server.
     *
     * @param baseUrl - The endpoint's `/v1`-style base URL.
     * @param apiKey - Optional key; omit for keyless local runtimes.
     */
    pinToEndpoint(baseUrl: string, apiKey?: string): void {
        this.pinModel = true;
        for (const provider of Object.keys(PROVIDER_CONFIGS) as GatewayProviderName[]) {
            this.baseUrls[provider] = baseUrl;
            // Explicit key wins; otherwise blank it so an ambient env key (e.g.
            // OPENROUTER_API_KEY) is NOT forwarded to the pinned endpoint.
            // Local runtimes are keyless, and getApiKey() returning "" makes
            // the adapter skip the Authorization header entirely.
            this.apiKeys[provider] = apiKey ?? "";
        }
    }

    /**
     * Resolve the provider for a model, with special handling:
     * - If the model starts with "openrouter/", use openrouter
     * - If the model starts with "anthropic/", use anthropic (via OpenRouter)
     * - If the model starts with "openai/" or is a known GPT/o1/o3 model, use openai
     * - If the model starts with "ollama/" or is a known local model, use ollama
     * - Otherwise, default to openrouter (which can route anywhere)
     */
    resolveProvider(model: string): GatewayProviderName {
        const provider = detectProvider(model);
        // For prefixed models, the detected provider is authoritative.
        if (model.includes("/")) {
            return provider;
        }
        // Unprefixed models default to openrouter (which handles routing).
        return "openrouter";
    }

    /**
     * Resolve the model name for the target provider:
     * - For openai: strip "openai/" prefix if present
     * - For openrouter: keep the full model string (OpenRouter expects "provider/model")
     * - For ollama: strip "ollama/" prefix
     * - For anthropic: keep "anthropic/model-name" (OpenRouter expects this format)
     */
    resolveModel(model: string, provider: GatewayProviderName): string {
        // Pinned endpoint: send the model ID exactly as given.
        if (this.pinModel) {
            return model;
        }
        if (provider === "openrouter") {
            return model; // OpenRouter expects the full "provider/model" format
        }
        return stripProviderPrefix(model);
    }

    /**
     * Get the API key for a provider, checking instance config first,
     * then environment variables.
     */
    private getApiKey(provider: GatewayProviderName): string | undefined {
        return this.apiKeys[provider] ?? process.env[PROVIDER_CONFIGS[provider].envKey];
    }

    /**
     * Get the base URL for a provider, checking instance config first.
     */
    private getBaseUrl(provider: GatewayProviderName): string {
        return this.baseUrls[provider] ?? PROVIDER_CONFIGS[provider].baseUrl;
    }

    /**
     * Complete a non-streaming request via the resolved provider.
     *
     * Internally configures the OpenAI-compatible adapter with the provider's
     * base URL and API key, then delegates to it.
     */
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const provider = this.resolveProvider(request.model);
        const model = this.resolveModel(request.model, provider);
        const baseUrl = this.getBaseUrl(provider);
        const apiKey = this.getApiKey(provider);
        const config = PROVIDER_CONFIGS[provider];

        configureOpenRouter({
            baseUrl,
            apiKey,
            skipAuth: !config.requiresAuth || !apiKey,
        });

        return openrouterComplete({ ...request, model });
    }

  /**
   * Complete a streaming request via the resolved provider.
   */
  async *completeStream(
  	request: CompletionRequest,
  ): AsyncGenerator<string, CompletionResponse> {
  	const provider = this.resolveProvider(request.model);
  	const model = this.resolveModel(request.model, provider);
  	const baseUrl = this.getBaseUrl(provider);
  	const apiKey = this.getApiKey(provider);
  	const config = PROVIDER_CONFIGS[provider];

  	configureOpenRouter({
  		baseUrl,
  		apiKey,
  		skipAuth: !config.requiresAuth || !apiKey,
  	});

  	const stream = openrouterCompleteStream({ ...request, model });
   const result = yield* stream;
   return result;
  }


    /**
     * Get the cost per 1M tokens for a model.
     * First tries dynamic resolution from OpenRouter's live API,
     * then falls back to the static fingerprint database.
     */
    async getModelPricing(model: string): Promise<{
        inputCostPerMillion: number;
        outputCostPerMillion: number;
        currency: string;
    } | null> {
        const provider = this.resolveProvider(model);
        const bareModel = this.resolveModel(model, provider);

        // 1. Try dynamic resolution from OpenRouter.
        try {
            const { resolveModelFingerprint } = await import("./dynamic-models.ts");
            const fp = await resolveModelFingerprint(model);
            if (fp) {
                return {
                    inputCostPerMillion: fp.inputCostPerMillion,
                    outputCostPerMillion: fp.outputCostPerMillion,
                    currency: "USD",
                };
            }
        } catch {
            // Network error — fall through to static.
        }

        // 2. Fall back to static fingerprints.
        // Bun 1.4: static import replaces require() — fingerprints.ts is
        // already loaded by openrouter-adapter.ts at module init, so this
        // is a cache hit with no additional I/O overhead.
        const fps = getStaticFingerprints();
        const fp = fps.find((f: { modelName: string }) =>
            f.modelName.toLowerCase() === bareModel.toLowerCase() ||
            f.modelName.toLowerCase() === model.toLowerCase()
        );
        return fp
            ? {
                  inputCostPerMillion: fp.inputCostPerMillion,
                  outputCostPerMillion: fp.outputCostPerMillion,
                  currency: "USD",
              }
            : null;
    }

    /**
     * List all known models grouped by provider.
     * Combines static fingerprints with live OpenRouter models.
     * Useful for building model selection UIs or documentation.
     */
    async listModels(): Promise<Record<string, Array<{ name: string; costPerMillion: number }>>> {
        const grouped: Record<string, Array<{ name: string; costPerMillion: number }>> = {};

        // Add static fingerprints.
        // Bun 1.4: static import avoids the require() CJS interop shim.
        const fps = getStaticFingerprints();
        for (const fp of fps) {
            const provider = detectProvider(fp.modelName);
            if (!grouped[provider]) grouped[provider] = [];
            grouped[provider].push({
                name: fp.modelName,
                costPerMillion: fp.inputCostPerMillion,
            });
        }

        // Merge in dynamic models from OpenRouter.
        try {
            const { listAllModels } = await import("./dynamic-models.ts");
            const dynamic = await listAllModels();
            for (const dm of dynamic) {
                if (!grouped[dm.provider]) grouped[dm.provider] = [];
                grouped[dm.provider].push({
                    name: dm.id,
                    costPerMillion: dm.inputCostPerMillion,
                });
            }
        } catch {
            // Ignore network errors — just return static fingerprints.
        }

        return grouped;
    }
}

// ─── Convenience: singleton gateway ────────────────────────────────────────────

/**
 * A shared gateway instance for simple usage without manual configuration.
 * Reads API keys from environment variables automatically.
 */
const sharedGateway = new ProviderGateway();

/**
 * Complete a request using the shared gateway (reads env vars automatically).
 */
export function complete(model: string, request: Omit<CompletionRequest, "model">): Promise<CompletionResponse> {
    return sharedGateway.complete({ ...request, model });
}

/**
 * Stream a request using the shared gateway.
 */
export async function* streamComplete(model: string, request: Omit<CompletionRequest, "model">): AsyncGenerator<string, CompletionResponse> {
    return yield* sharedGateway.completeStream({ ...request, model });
}

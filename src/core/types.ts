// Core type definitions for LLM-Guardian V1.0.0

// ─── Semantic Folding Engine Types ────────────────────────────────────────────

export interface EntityHeadline {
	/** The entity-dense headlinese representation, e.g. "[ACTION:Refactor][TARGET:VCM]" */
	headline: string;
	/** Number of tokens in the original text */
	originalTokens: number;
	/** Number of tokens after folding */
	foldedTokens: number;
	/** Compression ratio: foldedTokens / originalTokens */
	compressionRatio: number;
	/** Semantic density score (0-1) — higher means more information per token */
	semanticDensity: number;
	/** Named entities extracted and preserved */
	entities: string[];
	/** The action verbs extracted */
	actions: string[];
}

export interface FoldingResult {
	/** The compressed prompt ready for LLM submission */
	foldedPrompt: string;
	/** Metadata about the folding process */
	metadata: EntityHeadline;
	/** Estimated USD saved by folding */
	estimatedSavingsUsd: number;
	/** Time taken for folding in milliseconds */
	foldingTimeMs: number;
}

// ─── VCM Sharding Types ──────────────────────────────────────────────────────

export interface ContextSkeleton {
	/** High-level topic/subject of the conversation */
	topic: string;
	/** Key entities mentioned across all messages */
	entities: EntityNode[];
	/** The conversation flow graph */
	flow: FlowEdge[];
	/** Accumulated token count of full context */
	totalTokens: number;
}

export interface EntityNode {
	name: string;
	type: "person" | "org" | "concept" | "code" | "tool" | "data";
	relevanceScore: number;
	mentionCount: number;
	lastMentionIndex: number;
}

export interface FlowEdge {
	from: number;
	to: number;
	relationship: string;
	weight: number;
}

export interface KnowledgeShard {
	/** Unique identifier for this shard */
	id: string;
	/** The compressed content of this shard */
	content: string;
	/** Relevance score (0-1) for the current query */
	relevanceScore: number;
	/** Source message indices this shard covers */
	sourceIndices: number[];
	/** Token count of this shard */
	tokens: number;
}

export interface ShardingResult {
	/** The injected context ready for LLM */
	injectedContext: string;
	/** Individual shards used */
	shards: KnowledgeShard[];
	/** Original context tokens */
	originalTokens: number;
	/** Tokens after sharding */
	shardedTokens: number;
	/** Compression ratio achieved */
	compressionRatio: number;
	/** Number of shards removed by cross-shard dedup (v1.6.26) */
	shardsDeduped?: number;
	/** Sharded tokens used vs. budget (v1.6.26 adaptive budget) */
	budgetUsed?: number;
	/** Total token budget (v1.6.26 adaptive budget) */
	budgetTotal?: number;
}

// ─── Cross-Model Fingerprinting Types ────────────────────────────────────────

export interface ModelFingerprint {
	modelName: string;
	provider: string;
	/** Attention bias weights for different prompt sections */
	attentionBiases: AttentionBias;
	/** Optimal prompt structure template */
	optimalStructure: PromptSection[];
	/** Known context window */
	contextWindow: number;
	/** Max output tokens */
	maxOutputTokens: number;
	/** Cost per million input tokens */
	inputCostPerMillion: number;
	/** Cost per million output tokens */
	outputCostPerMillion: number;
	/** Supports streaming */
	supportsStreaming: boolean;
	/** Supports vision/image inputs */
	supportsVision: boolean;
	/** Supports tool/function calling */
	supportsToolUse: boolean;
}

export interface AttentionBias {
	systemPrompt: number;
	userFirstParagraph: number;
	userMiddleSection: number;
	userLastParagraph: number;
	examples: number;
	toolDefinitions: number;
}

export interface PromptSection {
	type: "system" | "context" | "instruction" | "examples" | "tools" | "query";
	priority: number;
	maxLength: number;
}

// ─── Tool Fusion Types ───────────────────────────────────────────────────────

export interface ToolOutput {
	toolName: string;
	result: unknown;
	latencyMs: number;
	tokens: number;
}

export interface FusedToolBlock {
	/** The single semantic block combining multiple tool outputs */
	fusedContent: string;
	/** Original tool outputs that were fused */
	originalOutputs: ToolOutput[];
	/** Tokens saved by fusing */
	tokensSaved: number;
	/** Fusion time in ms */
	fusionTimeMs: number;
}

// ─── Gateway Types ───────────────────────────────────────────────────────────

export interface PrivacyScanResult {
	original: string;
	sanitized: string;
	piiDetected: PIIMatch[];
	injectionDetected: boolean;
	blocked: boolean;
}

export interface PIIMatch {
	type: "email" | "phone" | "ssn" | "credit_card" | "ip_address" | "custom";
	original: string;
	redacted: string;
	start: number;
	end: number;
}

export interface BudgetStatus {
	allowed: boolean;
	reason?: string;
	estimatedCostUsd: number;
	dailySpentUsd: number;
	dailyLimitUsd: number;
	monthlySpentUsd: number;
	monthlyLimitUsd: number;
}

// ─── Orchestrator Types ──────────────────────────────────────────────────────

export interface GuardianRequest {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	tools?: ToolDefinition[];
	/** Enable Semantic Folding */
	enableFolding?: boolean;
	/** Enable VCM Sharding */
	enableSharding?: boolean;
	/** Enable Tool Fusion */
	enableToolFusion?: boolean;
	/**
	 * Enable Tool Gating (lazy tool-schema loading): filters the tool catalog
	 * down to the query-relevant subset before schemas are sent to the model.
	 * Zero-LLM-call, sub-millisecond. No-op for catalogs <= 8 tools.
	 */
	enableToolGating?: boolean;
	/**
	 * Enable Prompt Caching: reorders the conversation into a stable cacheable
	 * prefix and stamps Anthropic `cache_control` breakpoints, plus the
	 * `token-efficient-tools-2025` beta header when tools are present.
	 */
	enablePromptCaching?: boolean;
	/**
	 * Pre-built memory pack (e.g. a MemOS TOON context pack) to inject as a
	 * high-relevance context shard during VCM Sharding. This is the AI Trio
	 * integration point: llm-guardian consumes a token-budgeted memory slice
	 * produced by the memos (`@mem-os/sdk`) sibling repo instead of (or in
	 * addition to) re-deriving context purely from chat history.
	 *
	 * Expected to be compact, already-debloated text (TOON format yields
	 * 60-90% compression vs raw JSON). When present, it is injected ahead of
	 * the sharded chat history so the model sees grounded memory first.
	 * Leave undefined to disable memory injection. The pack is produced
	 * out-of-band (e.g. by a memos adapter) — Guardian takes no hard
	 * dependency on the memos package.
	 */
	memoryPack?: string;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	toolCallId?: string;
	name?: string;
}

export interface ToolDefinition {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface GuardianResponse {
	id: string;
	model: string;
	provider: string;
	content: string;
	usage: TokenUsage;
	costUsd: number;
	baselineCostUsd: number;
	savedUsd: number;
	latencyMs: number;
	/** Metrics from the optimization pipeline */
	optimization: OptimizationMetrics;
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface OptimizationMetrics {
	foldingApplied: boolean;
	foldingCompressionRatio?: number;
	foldingTimeMs?: number;
	shardingApplied: boolean;
	shardingCompressionRatio?: number;
	toolFusionApplied: boolean;
	toolFusionTokensSaved?: number;
	/** True if Tool Gating filtered the catalog before the call. */
	toolGatingApplied?: boolean;
	/** Number of tool schemas dropped by Tool Gating. */
	toolGatingRemoved?: number;
	/** True if Prompt Caching structured the prefix + set cache breakpoints. */
	promptCachingApplied?: boolean;
	/** Token count of the stable cacheable prefix (Prompt Caching). */
	promptCachingPrefixTokens?: number;
	/** True if the token-efficient-tools beta header was attached. */
	tokenEfficientToolsUsed?: boolean;
	/** True if the Retain Pre-Filter dropped low-signal turns before folding. */
	retainFilterApplied?: boolean;
	/** Number of turns dropped by the Retain Pre-Filter. */
	retainFilterDropped?: number;
	/** Tokens saved by dropping low-signal turns up front. */
	retainFilterTokensSaved?: number;
	/** True if a memory pack (e.g. MemOS TOON) was injected during sharding. */
	memoryPackInjected?: boolean;
	/** Tokens the injected memory pack occupied in the final prompt. */
	memoryPackTokens?: number;
	totalTokensSaved: number;
	totalSavingsUsd: number;
}

// ─── Provider Types ──────────────────────────────────────────────────────────

export interface ProviderConfig {
	name: string;
	apiKey: string;
	baseUrl: string;
	models: string[];
}

export interface CompletionRequest {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	tools?: ToolDefinition[];
	/** Attach the token-efficient-tools-2025 beta header (compact tool schemas). */
	tokenEfficientTools?: boolean;
}

export interface CompletionResponse {
	id: string;
	model: string;
	content: string;
	toolCalls?: ToolCall[];
	usage: TokenUsage;
	finishReason: string;
}

export interface ToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

// ─── Analytics Types ─────────────────────────────────────────────────────────

export interface RequestEvent {
	requestId: string;
	model: string;
	provider: string;
	promptTokens: number;
	completionTokens: number;
	costUsd: number;
	baselineCostUsd: number;
	savedUsd: number;
	latencyMs: number;
	status: "ok" | "error" | "cached";
	cacheHit: boolean;
	optimizationMetrics?: OptimizationMetrics;
	timestamp: number;
}

export interface AggregatedStats {
	totalRequests: number;
	totalCostUsd: number;
	totalBaselineCostUsd: number;
	totalSavedUsd: number;
	avgLatencyMs: number;
	cacheHitRate: number;
	avgCompressionRatio: number;
	totalTokensOptimized: number;
}

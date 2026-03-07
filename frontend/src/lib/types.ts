export type JsonObject = Record<string, unknown>;

export interface PeriodStats {
  total_cost_usd: number;
  baseline_cost_usd: number;
  saved_usd: number;
  request_count: number;
  days: number;
}

export interface StatsSummary {
  total_requests: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  today: PeriodStats;
  last_30_days: PeriodStats;
  total_saved_usd: number;
  baseline_cost_usd: number;
  cache_hit_rate: number;
}

export interface ModelStat {
  model_name: string;
  provider: string;
  request_count: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  saved_usd: number;
}

export interface ModelsStatsResponse {
  models: ModelStat[];
}

export interface ProviderStat {
  provider: string;
  request_count: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  saved_usd: number;
}

export interface ProvidersStatsResponse {
  providers: ProviderStat[];
}

export interface CostsResponse {
  today: PeriodStats;
  last_7_days: PeriodStats;
  last_30_days: PeriodStats;
}

export interface SavingsPeriod {
  saved_usd: number;
  baseline_cost_usd: number;
}

export interface SavingsResponse {
  last_7_days: SavingsPeriod;
  last_30_days: SavingsPeriod;
}

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
}

export interface ProviderModel {
  model: string;
  pricing: ModelPricing;
  p95_latency_ms: number;
}

export interface ProviderCatalogEntry {
  provider: string;
  models: ProviderModel[];
}

export interface ProvidersResponse {
  baseline_model: string;
  providers: ProviderCatalogEntry[];
}

export type LogStatus = "ok" | "error" | string;

export interface LogItem {
  id: string;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  baseline_cost_usd: number;
  saved_usd: number;
  latency_ms: number;
  status: LogStatus;
  error_code: string | null;
  cache_hit: boolean;
  created_at: string | null;
}

export interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  items: LogItem[];
}

export interface LogsListParams {
  limit?: number;
  offset?: number;
  status?: string;
  model?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface KeysResponse {
  keys: ApiKey[];
}

export interface KeyUpdateInput {
  name?: string;
  is_active?: boolean;
}

export type RuleType =
  | "preferred_model"
  | "preferred_provider"
  | "provider_pin"
  | "budget_cap"
  | "max_request_spend"
  | "max_tokens"
  | string;

export interface UserRule {
  id: string;
  name: string;
  rule_type: RuleType;
  value: JsonObject;
  priority: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface RulesResponse {
  rules: UserRule[];
}

export interface RuleCreateInput {
  name: string;
  rule_type: RuleType;
  value: JsonObject;
  priority?: number;
  is_active?: boolean;
}

export interface RuleUpdateInput {
  name?: string;
  rule_type?: RuleType;
  value?: JsonObject;
  priority?: number;
  is_active?: boolean;
}

export interface DeleteResponse {
  deleted: boolean;
  id: string;
}

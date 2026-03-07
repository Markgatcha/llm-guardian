import type {
  ApiKey,
  CostsResponse,
  CreatedApiKey,
  DeleteResponse,
  JsonObject,
  KeysResponse,
  LogItem,
  LogsListParams,
  LogsResponse,
  ModelPricing,
  ModelStat,
  ModelsStatsResponse,
  PeriodStats,
  ProviderCatalogEntry,
  ProviderModel,
  ProviderStat,
  ProvidersResponse,
  ProvidersStatsResponse,
  RuleCreateInput,
  RulesResponse,
  RuleUpdateInput,
  SavingsPeriod,
  SavingsResponse,
  StatsSummary,
  UserRule,
} from "@/lib/types";

export const ADMIN_KEY_STORAGE_KEY = "guardian_admin_key";
const API_BASE_PATH = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export class AuthError extends ApiError {
  constructor(message = "Unauthorized", status = 401, details: unknown = null) {
    super(message, status, details);
    this.name = "AuthError";
  }
}

export function getStoredAdminKey(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while contacting LLM Guardian.";
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toPeriodStats(payload: unknown, fallbackDays = 0): PeriodStats {
  const record = asRecord(payload);
  return {
    total_cost_usd: asNumber(record.total_cost_usd ?? record.cost_usd),
    baseline_cost_usd: asNumber(record.baseline_cost_usd),
    saved_usd: asNumber(record.saved_usd),
    request_count: asNumber(record.request_count ?? record.requests),
    days: asNumber(record.days, fallbackDays),
  };
}

function toSavingsPeriod(payload: unknown): SavingsPeriod {
  const record = asRecord(payload);
  return {
    saved_usd: asNumber(record.saved_usd),
    baseline_cost_usd: asNumber(record.baseline_cost_usd),
  };
}

function normalizeStatsSummary(payload: unknown): StatsSummary {
  const record = asRecord(payload);
  return {
    total_requests: asNumber(record.total_requests),
    total_cost_usd: asNumber(record.total_cost_usd),
    avg_latency_ms: asNumber(record.avg_latency_ms),
    today: toPeriodStats(record.today, 1),
    last_30_days: toPeriodStats(record.last_30_days, 30),
    total_saved_usd: asNumber(record.total_saved_usd),
    baseline_cost_usd: asNumber(record.baseline_cost_usd),
    cache_hit_rate: asNumber(record.cache_hit_rate),
  };
}

function normalizeModelStat(payload: unknown): ModelStat {
  const record = asRecord(payload);
  return {
    model_name: asString(record.model_name ?? record.model),
    provider: asString(record.provider),
    request_count: asNumber(record.request_count ?? record.requests),
    total_cost_usd: asNumber(record.total_cost_usd ?? record.cost_usd),
    avg_latency_ms: asNumber(record.avg_latency_ms),
    cache_hit_rate: asNumber(record.cache_hit_rate),
    saved_usd: asNumber(record.saved_usd),
  };
}

function normalizeProviderStat(payload: unknown): ProviderStat {
  const record = asRecord(payload);
  return {
    provider: asString(record.provider),
    request_count: asNumber(record.request_count ?? record.requests),
    total_cost_usd: asNumber(record.total_cost_usd ?? record.cost_usd),
    avg_latency_ms: asNumber(record.avg_latency_ms),
    saved_usd: asNumber(record.saved_usd),
  };
}

function normalizePricing(payload: unknown): ModelPricing {
  const record = asRecord(payload);
  const inputPerMillion =
    asNumber(record.input_per_million) ||
    asNumber(record.input_cost_per_1k) * 1000 ||
    asNumber(record.input) * 1000;
  const outputPerMillion =
    asNumber(record.output_per_million) ||
    asNumber(record.output_cost_per_1k) * 1000 ||
    asNumber(record.output) * 1000;
  return {
    input_per_million: inputPerMillion,
    output_per_million: outputPerMillion,
  };
}

function normalizeProviderModel(payload: unknown): ProviderModel {
  const record = asRecord(payload);
  return {
    model: asString(record.model),
    pricing: normalizePricing(record.pricing ?? record),
    p95_latency_ms: asNumber(record.p95_latency_ms),
  };
}

function normalizeProviderCatalogEntry(payload: unknown): ProviderCatalogEntry {
  const record = asRecord(payload);
  return {
    provider: asString(record.provider),
    models: asArray(record.models).map(normalizeProviderModel),
  };
}

function normalizeLogStatus(status: string): string {
  if (status === "success") {
    return "ok";
  }

  return status;
}

function normalizeLogItem(payload: unknown): LogItem {
  const record = asRecord(payload);
  return {
    id: asString(record.id),
    model: asString(record.model),
    provider: asString(record.provider),
    prompt_tokens: asNumber(record.prompt_tokens),
    completion_tokens: asNumber(record.completion_tokens),
    cost_usd: asNumber(record.cost_usd),
    baseline_cost_usd: asNumber(record.baseline_cost_usd),
    saved_usd: asNumber(record.saved_usd),
    latency_ms: asNumber(record.latency_ms),
    status: normalizeLogStatus(asString(record.status)),
    error_code: asNullableString(record.error_code),
    cache_hit: asBoolean(record.cache_hit),
    created_at: asNullableString(record.created_at),
  };
}

function normalizeApiKey(payload: unknown): ApiKey {
  const record = asRecord(payload);
  return {
    id: asString(record.id),
    name: asString(record.name),
    is_active: asBoolean(record.is_active),
    created_at: asNullableString(record.created_at),
    updated_at: asNullableString(record.updated_at),
  };
}

function normalizeCreatedApiKey(payload: unknown): CreatedApiKey {
  const record = asRecord(payload);
  return {
    ...normalizeApiKey(record),
    key: asString(record.key),
  };
}

function normalizeRule(payload: unknown): UserRule {
  const record = asRecord(payload);
  return {
    id: asString(record.id),
    name: asString(record.name),
    rule_type: asString(record.rule_type),
    value: asRecord(record.value),
    priority: asNumber(record.priority),
    is_active: asBoolean(record.is_active),
    created_at: asNullableString(record.created_at),
    updated_at: asNullableString(record.updated_at),
  };
}

function normalizeDeleteResponse(payload: unknown): DeleteResponse {
  const record = asRecord(payload);
  return {
    deleted: asBoolean(record.deleted),
    id: asString(record.id),
  };
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  const record = asRecord(payload);
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  const message = record.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }

  if (status === 401 || status === 403) {
    return "Your admin key was rejected. Sign in again to continue.";
  }

  return "LLM Guardian could not complete that request.";
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  normalizer?: (payload: unknown) => T
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Guardian-Key", getStoredAdminKey() ?? "");
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new ApiError(
      "Unable to reach LLM Guardian. Check that the backend is running.",
      0,
      error
    );
  }

  let payload: unknown = null;
  if (response.status !== 204) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      const text = await response.text();
      payload = text || null;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(payload, response.status);
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(message, response.status, payload);
    }
    throw new ApiError(message, response.status, payload);
  }

  return normalizer ? normalizer(payload) : (payload as T);
}

function withQuery(path: string, params: LogsListParams): string {
  const searchParams = new URLSearchParams();
  if (typeof params.limit === "number") {
    searchParams.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    searchParams.set("offset", String(params.offset));
  }
  if (params.status) {
    searchParams.set("status", params.status);
  }
  if (params.model) {
    searchParams.set("model", params.model);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export const api = {
  stats: {
    summary: () => request("/stats/summary", {}, normalizeStatsSummary),
    models: () =>
      request("/stats/models", {}, (payload): ModelsStatsResponse => {
        const record = asRecord(payload);
        return {
          models: asArray(record.models).map(normalizeModelStat),
        };
      }),
    providers: () =>
      request("/stats/providers", {}, (payload): ProvidersStatsResponse => {
        const record = asRecord(payload);
        return {
          providers: asArray(record.providers).map(normalizeProviderStat),
        };
      }),
    costs: () =>
      request("/stats/costs", {}, (payload): CostsResponse => {
        const record = asRecord(payload);
        return {
          today: toPeriodStats(record.today, 1),
          last_7_days: toPeriodStats(record.last_7_days, 7),
          last_30_days: toPeriodStats(record.last_30_days, 30),
        };
      }),
    savings: () =>
      request("/stats/savings", {}, (payload): SavingsResponse => {
        const record = asRecord(payload);
        return {
          last_7_days: toSavingsPeriod(record.last_7_days),
          last_30_days: toSavingsPeriod(record.last_30_days),
        };
      }),
  },
  providers: {
    list: () =>
      request("/providers", {}, (payload): ProvidersResponse => {
        const record = asRecord(payload);
        return {
          baseline_model: asString(record.baseline_model),
          providers: asArray(record.providers).map(normalizeProviderCatalogEntry),
        };
      }),
  },
  logs: {
    list: (params: LogsListParams = {}) =>
      request(withQuery("/logs", params), {}, (payload): LogsResponse => {
        const record = asRecord(payload);
        return {
          total: asNumber(record.total),
          limit: asNumber(record.limit),
          offset: asNumber(record.offset),
          items: asArray(record.items).map(normalizeLogItem),
        };
      }),
  },
  keys: {
    list: () =>
      request("/keys", {}, (payload): KeysResponse => {
        const record = asRecord(payload);
        return {
          keys: asArray(record.keys).map(normalizeApiKey),
        };
      }),
    create: (name: string) =>
      request("/keys", { method: "POST", body: JSON.stringify({ name }) }, normalizeCreatedApiKey),
    update: (id: string, data: { name?: string; is_active?: boolean }) =>
      request(
        `/keys/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        normalizeApiKey
      ),
    delete: (id: string) => request(`/keys/${id}`, { method: "DELETE" }, normalizeDeleteResponse),
  },
  rules: {
    list: () =>
      request("/rules", {}, (payload): RulesResponse => {
        const record = asRecord(payload);
        return {
          rules: asArray(record.rules).map(normalizeRule),
        };
      }),
    create: (data: RuleCreateInput) =>
      request("/rules", { method: "POST", body: JSON.stringify(data) }, normalizeRule),
    update: (id: string, data: RuleUpdateInput) =>
      request(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(data) }, normalizeRule),
    delete: (id: string) => request(`/rules/${id}`, { method: "DELETE" }, normalizeDeleteResponse),
  },
};

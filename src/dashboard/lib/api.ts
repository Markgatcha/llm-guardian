const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${API_BASE}/api/v1${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`API returned HTML (status ${res.status}). Is the backend running at ${API_BASE}?`);
    }
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface StatsSummary {
  totalRequests: number;
  totalCostUsd: number;
  totalBaselineCostUsd: number;
  totalSavedUsd: number;
  avgLatencyMs: number;
  cacheHitRate: number;
  avgCompressionRatio: number;
  totalTokensOptimized: number;
  today: { requests: number; costUsd: number; savedUsd: number };
  month: { requests: number; costUsd: number; savedUsd: number };
}

export interface CompressionStats {
  avgCompressionRatio: number;
  totalTokensOptimized: number;
}

export interface SavingsStats {
  totalSavedUsd: number;
  todaySavedUsd: number;
  monthSavedUsd: number;
  avgCompressionRatio: number;
  totalTokensOptimized: number;
}

export interface ProviderInfo {
  model: string;
  provider: string;
  contextWindow: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsToolUse: boolean;
}

export interface ProvidersResponse {
  models: ProviderInfo[];
}

export interface LogItem {
  requestId: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  latencyMs: number;
  status: string;
  cacheHit: boolean;
  timestamp: number;
}

export interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  items: LogItem[];
}

export const api = {
  stats: {
    summary: () => fetchJson<StatsSummary>("/stats/summary"),
    compression: () => fetchJson<CompressionStats>("/stats/compression"),
    savings: () => fetchJson<SavingsStats>("/stats/savings"),
  },
  providers: () => fetchJson<ProvidersResponse>("/providers"),
  logs: (limit = 100, offset = 0) =>
    fetchJson<LogsResponse>(`/logs?limit=${limit}&offset=${offset}`),
};

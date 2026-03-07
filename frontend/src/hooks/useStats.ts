import { useCallback } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import type { CostsResponse, ModelStat, ProviderStat, StatsSummary } from "@/lib/types";

interface StatsBundle {
  summary: StatsSummary;
  models: ModelStat[];
  providers: ProviderStat[];
  costs: CostsResponse;
}

export interface UseStatsResult {
  summary: StatsSummary | null;
  models: ModelStat[];
  providers: ProviderStat[];
  costs: CostsResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useStats(): UseStatsResult {
  const fetcher = useCallback(async (): Promise<StatsBundle> => {
    const [summary, modelsResponse, providersResponse, costs] = await Promise.all([
      api.stats.summary(),
      api.stats.models(),
      api.stats.providers(),
      api.stats.costs(),
    ]);

    return {
      summary,
      models: modelsResponse.models,
      providers: providersResponse.providers,
      costs,
    };
  }, []);

  const { data, loading, error, refetch } = useApiQuery(fetcher, []);

  return {
    summary: data?.summary ?? null,
    models: data?.models ?? [],
    providers: data?.providers ?? [],
    costs: data?.costs ?? null,
    loading,
    error,
    refetch,
  };
}

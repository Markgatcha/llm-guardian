/**
 * useStats — fetches the /api/v1/stats/summary endpoint.
 *
 * TODO: add polling interval / SWR-style revalidation.
 * TODO: replace with a proper API client module.
 */
import { useEffect, useState } from "react";

interface StatsSummary {
  total_requests: number;
  total_cost_usd: number;
  avg_latency_ms: number;
}

interface UseStatsResult {
  data: StatsSummary | null;
  loading: boolean;
  error: string | null;
}

export function useStats(): UseStatsResult {
  const [data, setData] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch("/api/v1/stats/summary");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatsSummary;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}

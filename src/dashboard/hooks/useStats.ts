import { useCallback, useEffect, useState } from "react";
import type { StatsSummary } from "../lib/api";
import { api } from "../lib/api";

export function useStats() {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.stats.summary();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { summary, loading, error, refetch: fetchStats };
}

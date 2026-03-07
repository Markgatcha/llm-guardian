import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import type { LogsResponse } from "@/lib/types";

export interface LogFilters {
  model: string;
  status: string;
  limit: number;
}

export interface UseLogsResult {
  logs: LogsResponse["items"];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  filters: LogFilters;
  setFilters: Dispatch<SetStateAction<LogFilters>>;
  refetch: () => Promise<void>;
}

export function useLogs(initialFilters: Partial<LogFilters> = {}): UseLogsResult {
  const [page, setPage] = useState(1);
  const [filtersState, setFiltersState] = useState<LogFilters>({
    model: initialFilters.model ?? "",
    status: initialFilters.status ?? "all",
    limit: initialFilters.limit ?? 25,
  });

  const fetcher = useCallback(
    () =>
      api.logs.list({
        limit: filtersState.limit,
        offset: (page - 1) * filtersState.limit,
        status: filtersState.status === "all" ? undefined : filtersState.status,
        model: filtersState.model.trim() || undefined,
      }),
    [filtersState.limit, filtersState.model, filtersState.status, page]
  );

  const { data, loading, error, refetch } = useApiQuery(fetcher, [
    page,
    filtersState.limit,
    filtersState.model,
    filtersState.status,
  ]);

  const setFilters: Dispatch<SetStateAction<LogFilters>> = useCallback((nextValue) => {
    setFiltersState((current) => {
      const nextState = typeof nextValue === "function" ? nextValue(current) : nextValue;
      return nextState;
    });
    setPage(1);
  }, []);

  return {
    logs: data?.items ?? [],
    total: data?.total ?? 0,
    loading,
    error,
    page,
    setPage,
    filters: filtersState,
    setFilters,
    refetch,
  };
}

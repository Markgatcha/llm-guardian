import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthError, getErrorMessage } from "@/lib/api";

export interface UseApiQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): UseApiQueryResult<T> {
  const { setAdminKey } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (error) {
      if (error instanceof AuthError) {
        setAdminKey(null);
      }
      if (mountedRef.current) {
        setError(getErrorMessage(error));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [setAdminKey]);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, ...deps]);

  return { data, loading, error, refetch };
}

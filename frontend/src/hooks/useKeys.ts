import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, AuthError, getErrorMessage } from "@/lib/api";
import type { ApiKey, CreatedApiKey, DeleteResponse, KeyUpdateInput } from "@/lib/types";

export interface UseKeysResult {
  keys: ApiKey[];
  loading: boolean;
  error: string | null;
  createKey: (name: string) => Promise<CreatedApiKey>;
  updateKey: (id: string, data: KeyUpdateInput) => Promise<ApiKey>;
  deleteKey: (id: string) => Promise<DeleteResponse>;
  refetch: () => Promise<void>;
}

export function useKeys(): UseKeysResult {
  const { setAdminKey } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (errorValue: unknown, updateSharedError = true) => {
      if (errorValue instanceof AuthError) {
        setAdminKey(null);
      }
      if (updateSharedError) {
        setError(getErrorMessage(errorValue));
      }
    },
    [setAdminKey]
  );

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.keys.list();
      setKeys(response.keys);
    } catch (errorValue) {
      handleError(errorValue);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createKey = useCallback(
    async (name: string) => {
      setLoading(true);
      setError(null);
      try {
        const createdKey = await api.keys.create(name);
        await refetch();
        return createdKey;
      } catch (errorValue) {
        handleError(errorValue, false);
        throw errorValue;
      } finally {
        setLoading(false);
      }
    },
    [handleError, refetch]
  );

  const updateKey = useCallback(
    async (id: string, data: KeyUpdateInput) => {
      setLoading(true);
      setError(null);
      try {
        const updatedKey = await api.keys.update(id, data);
        await refetch();
        return updatedKey;
      } catch (errorValue) {
        handleError(errorValue, false);
        throw errorValue;
      } finally {
        setLoading(false);
      }
    },
    [handleError, refetch]
  );

  const deleteKey = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.keys.delete(id);
        await refetch();
        return result;
      } catch (errorValue) {
        handleError(errorValue, false);
        throw errorValue;
      } finally {
        setLoading(false);
      }
    },
    [handleError, refetch]
  );

  return {
    keys,
    loading,
    error,
    createKey,
    updateKey,
    deleteKey,
    refetch,
  };
}

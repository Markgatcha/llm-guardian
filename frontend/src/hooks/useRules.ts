import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, AuthError, getErrorMessage } from "@/lib/api";
import type { DeleteResponse, RuleCreateInput, RuleUpdateInput, UserRule } from "@/lib/types";

export interface UseRulesResult {
  rules: UserRule[];
  loading: boolean;
  error: string | null;
  createRule: (data: RuleCreateInput) => Promise<UserRule>;
  updateRule: (id: string, data: RuleUpdateInput) => Promise<UserRule>;
  deleteRule: (id: string) => Promise<DeleteResponse>;
  refetch: () => Promise<void>;
}

export function useRules(): UseRulesResult {
  const { setAdminKey } = useAuth();
  const [rules, setRules] = useState<UserRule[]>([]);
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
      const response = await api.rules.list();
      setRules(response.rules);
    } catch (errorValue) {
      handleError(errorValue);
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createRule = useCallback(
    async (data: RuleCreateInput) => {
      setLoading(true);
      setError(null);
      try {
        const createdRule = await api.rules.create(data);
        await refetch();
        return createdRule;
      } catch (errorValue) {
        handleError(errorValue, false);
        throw errorValue;
      } finally {
        setLoading(false);
      }
    },
    [handleError, refetch]
  );

  const updateRule = useCallback(
    async (id: string, data: RuleUpdateInput) => {
      setLoading(true);
      setError(null);
      try {
        const updatedRule = await api.rules.update(id, data);
        await refetch();
        return updatedRule;
      } catch (errorValue) {
        handleError(errorValue, false);
        throw errorValue;
      } finally {
        setLoading(false);
      }
    },
    [handleError, refetch]
  );

  const deleteRule = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.rules.delete(id);
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
    rules,
    loading,
    error,
    createRule,
    updateRule,
    deleteRule,
    refetch,
  };
}

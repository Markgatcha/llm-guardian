import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import { AuthError } from "@/lib/api";

describe("useApiQuery", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it("returns loading then data on success", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: "ready" });
    const { result } = renderHook(() => useApiQuery(fetcher, []), { wrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toEqual({ value: "ready" });
    });
  });

  it("returns loading then error on failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network failed"));
    const { result } = renderHook(() => useApiQuery(fetcher, []), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("Network failed");
    });
  });

  it("clears auth on AuthError", async () => {
    localStorage.setItem("guardian_admin_key", "secret-value");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    const fetcher = vi.fn().mockRejectedValue(new AuthError("Bad key", 401));

    renderHook(() => useApiQuery(fetcher, []), { wrapper });

    await waitFor(() => {
      expect(removeItemSpy).toHaveBeenCalledWith("guardian_admin_key");
    });
  });
});

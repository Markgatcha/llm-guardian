import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, AuthError, api } from "@/lib/api";

describe("api", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("guardian_admin_key", "test-admin-key");
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
    localStorage.clear();
  });

  it("api.stats.summary() makes fetch with correct URL and X-Guardian-Key header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total_requests: 10,
          total_cost_usd: 1.25,
          avg_latency_ms: 140,
          today: { total_cost_usd: 0.25, baseline_cost_usd: 0.4, saved_usd: 0.15 },
          last_30_days: { total_cost_usd: 1.25, baseline_cost_usd: 1.6, saved_usd: 0.35 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    await api.stats.summary();

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/stats/summary",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    const requestHeaders = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers) ?? new Headers();
    expect(requestHeaders.get("X-Guardian-Key")).toBe("test-admin-key");
  });

  it("throws AuthError on 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(api.stats.summary()).rejects.toBeInstanceOf(AuthError);
  });

  it("throws ApiError on 500", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Server exploded" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(api.stats.summary()).rejects.toBeInstanceOf(ApiError);
  });
});

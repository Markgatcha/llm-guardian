import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/LoginPage";

const mockedSetAdminKey = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    adminKey: null,
    setAdminKey: mockedSetAdminKey,
    isAuthenticated: false,
  }),
}));

describe("LoginPage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    mockedSetAdminKey.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
  });

  it("renders the form", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: /llm guardian/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/admin api key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
  });

  it("shows error on failed auth", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    const user = userEvent.setup();

    render(<LoginPage />);
    await user.type(screen.getByLabelText(/admin api key/i), "sk-guardian-invalid");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/the admin key was rejected\. check the key and try again\./i)
      ).toBeInTheDocument();
    });
  });

  it("calls setAdminKey on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total_requests: 1,
          total_cost_usd: 0.01,
          avg_latency_ms: 50,
          today: { total_cost_usd: 0.01, baseline_cost_usd: 0.02, saved_usd: 0.01 },
          last_30_days: { total_cost_usd: 0.01, baseline_cost_usd: 0.02, saved_usd: 0.01 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    const user = userEvent.setup();

    render(<LoginPage />);
    await user.type(screen.getByLabelText(/admin api key/i), "sk-guardian-valid");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(mockedSetAdminKey).toHaveBeenCalledWith("sk-guardian-valid");
    });
  });
});

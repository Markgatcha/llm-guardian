import { describe, it, expect, beforeEach } from "bun:test";
import {
  checkBudget,
  recordSpend,
  isExpensive,
  configure,
  getConfig,
  getSpendSummary,
  resetSpend,
} from "../gateway/budget-manager.ts";

describe("budget-manager", () => {
  beforeEach(() => {
    // Reset to defaults and clear any recorded spend. The module keeps an
    // internal spend log; set a tiny budget so per-request checks are
    // deterministic and isolated from real-clock drift.
    resetSpend();
    configure({
      maxRequestCostUsd: 1.0,
      dailyBudgetUsd: 50.0,
      monthlyBudgetUsd: 500.0,
      expensiveThresholdUsd: 0.5,
    });
  });

  it("allows a request within all limits", () => {
    const status = checkBudget(0.1);
    expect(status.allowed).toBe(true);
    expect(status.reason).toBeUndefined();
  });

  it("blocks a request over the per-request limit", () => {
    const status = checkBudget(2.0);
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain("per-request limit");
  });

  it("blocks when the daily budget would be exceeded", () => {
    recordSpend(49.0);
    const status = checkBudget(2.0); // 49 + 2 > 50
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain("Daily budget");
  });

  it("blocks when the monthly budget would be exceeded", () => {
    recordSpend(499.0);
    const status = checkBudget(2.0); // 499 + 2 > 500
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain("Monthly budget");
  });

  it("flags expensive requests above the threshold", () => {
    expect(isExpensive(0.6)).toBe(true);
    expect(isExpensive(0.4)).toBe(false);
  });

  it("configure merges overrides and exposes them via getConfig", () => {
    configure({ maxRequestCostUsd: 5.0 });
    expect(getConfig().maxRequestCostUsd).toBe(5.0);
    // Other fields retain their previous values.
    expect(getConfig().dailyBudgetUsd).toBe(50.0);
  });

  it("getSpendSummary reflects recorded spend", () => {
    recordSpend(10.0);
    recordSpend(5.0);
    const summary = getSpendSummary();
    expect(summary.dailySpentUsd).toBeCloseTo(15.0, 5);
    expect(summary.totalRecords).toBeGreaterThanOrEqual(2);
  });
});

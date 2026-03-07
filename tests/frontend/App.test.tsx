/**
 * tests/frontend/App.test.tsx
 *
 * Smoke-tests for the root App component.
 * TODO: add route-level tests once pages have real content.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "../../src/App";

describe("App", () => {
  it("renders without crashing", () => {
    render(<App />);
    // The dashboard heading should be present on the default route.
    expect(screen.getByText("LLM Guardian")).toBeDefined();
  });
});

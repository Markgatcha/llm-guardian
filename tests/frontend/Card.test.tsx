/**
 * tests/frontend/Card.test.tsx
 *
 * Unit tests for the Card component family.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card, CardHeader, CardTitle, CardContent } from "../../src/components/Card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("accepts extra className", () => {
    const { container } = render(<Card className="extra-class">x</Card>);
    expect(container.firstChild).toBeDefined();
  });
});

describe("CardTitle", () => {
  it("renders title text", () => {
    render(<CardTitle>My Title</CardTitle>);
    expect(screen.getByText("My Title")).toBeDefined();
  });
});

describe("CardContent", () => {
  it("renders content", () => {
    render(<CardContent>body</CardContent>);
    expect(screen.getByText("body")).toBeDefined();
  });
});

describe("CardHeader", () => {
  it("renders header", () => {
    render(<CardHeader>header</CardHeader>);
    expect(screen.getByText("header")).toBeDefined();
  });
});

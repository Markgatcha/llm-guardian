import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  it("renders different variants", () => {
    render(
      <div>
        <Badge variant="default">Default</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="error">Error</Badge>
      </div>
    );

    expect(screen.getByText("Default").className).toMatch(/brand/);
    expect(screen.getByText("Success").className).toMatch(/emerald/);
    expect(screen.getByText("Error").className).toMatch(/red/);
  });

  it("applies custom className", () => {
    render(
      <Badge variant="muted" className="tracking-widest">
        Custom
      </Badge>
    );

    expect(screen.getByText("Custom").className).toContain("tracking-widest");
  });
});

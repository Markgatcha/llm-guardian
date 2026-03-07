import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renders with default variant", () => {
    render(<Button>Save changes</Button>);
    expect(screen.getByRole("button", { name: /save changes/i }).className).toMatch(/bg-brand-500/);
  });

  it("renders with destructive variant", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button", { name: /delete/i }).className).toMatch(/bg-red-600/);
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<Button onClick={handleClick}>Run action</Button>);
    await user.click(screen.getByRole("button", { name: /run action/i }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("disabled state prevents click", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <Button disabled onClick={handleClick}>
        Disabled action
      </Button>
    );
    await user.click(screen.getByRole("button", { name: /disabled action/i }));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it("renders icon variant", () => {
    render(
      <Button variant="ghost" size="icon" aria-label="Settings">
        <span aria-hidden="true">S</span>
      </Button>
    );
    expect(screen.getByRole("button", { name: /settings/i }).className).toMatch(/w-10/);
  });
});

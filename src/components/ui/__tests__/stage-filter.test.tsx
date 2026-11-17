// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StageFilter } from "@/components/ui/stage-filter";

const options = [
  { key: "to_prep", label: "To pick", count: 18 },
  { key: "prepped", label: "Prepped", count: 24 },
  { key: "deployed", label: "Out", count: 0 },
];

describe("StageFilter", () => {
  it("shows words with counts and filters on click; clicking the active word clears", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<StageFilter options={options} value={null} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /To pick/ }).textContent).toContain("18");
    await user.click(screen.getByRole("button", { name: /Prepped/ }));
    expect(onChange).toHaveBeenLastCalledWith("prepped");
    rerender(<StageFilter options={options} value="prepped" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Prepped/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Prepped/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("arrow keys, Home and End move focus; Enter selects", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StageFilter options={options} value={null} onChange={onChange} />);
    screen.getByRole("button", { name: /To pick/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Prepped/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Out/ }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /To pick/ }));
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("to_prep");
  });
});

// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  DensityToggle,
  ViewModeToggle,
  DENSITY_ROW_PX,
  type Density,
  type ViewMode,
} from "@/components/ui/density-toggle";

describe("DensityToggle / ViewModeToggle", () => {
  it("exposes the 44/52/60 density scale", () => {
    expect(DENSITY_ROW_PX).toEqual({ compact: 44, comfortable: 52, relaxed: 60 });
  });

  it("marks the active density with aria-pressed and fires onChange", () => {
    const onChange = vi.fn();
    function Harness() {
      const [v, setV] = React.useState<Density>("comfortable");
      return (
        <DensityToggle
          value={v}
          onChange={(next) => {
            setV(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: /Comfortable/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Compact/ }));
    expect(onChange).toHaveBeenCalledWith("compact");
    expect(
      screen.getByRole("button", { name: /Compact/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("ViewModeToggle switches between cards and table", () => {
    const onChange = vi.fn();
    function Harness() {
      const [v, setV] = React.useState<ViewMode>("cards");
      return (
        <ViewModeToggle
          value={v}
          onChange={(next) => {
            setV(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: /Cards/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Table/ }));
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("labels each control as an accessible group (density vs view are distinct)", () => {
    render(
      <>
        <DensityToggle value="comfortable" onChange={() => {}} />
        <ViewModeToggle value="cards" onChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("group", { name: "Row density" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "View mode" })).toBeTruthy();
  });
});

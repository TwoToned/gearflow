// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProjectLifecycle } from "@/components/projects/project-lifecycle";

describe("Lifecycle steppers — mobile overflow", () => {
  it("ProjectLifecycle scrolls sideways and renders all stages without crashing", () => {
    const { container } = render(<ProjectLifecycle status="CHECKED_OUT" />);
    const ol = container.querySelector("ol")!;
    expect(ol.className).toContain("overflow-x-auto");
    // Stage labels stay on one line (no wrap collision).
    expect(screen.getByText("On site").className).toContain("whitespace-nowrap");
    expect(screen.getByText("Completed")).toBeTruthy();
  });
});

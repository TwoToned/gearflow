// @vitest-environment jsdom
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabStrip } from "@/components/ui/tab-strip";

function Harness() {
  const [v, setV] = useState("overview");
  return (
    <TabStrip
      value={v}
      onValueChange={setV}
      items={[
        { value: "overview", label: "Overview" },
        { value: "equipment", label: "Equipment", count: 44 },
        { value: "tasks", label: "Tasks & notes", count: "9/14" },
      ]}
    />
  );
}

describe("TabStrip", () => {
  it("shows counts and marks the active tab", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: /Equipment 44/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Tasks & notes 9\/14/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
  it("arrow keys, End and Home move through the strip", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Equipment/ }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Tasks/ }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
  it("click selects", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("tab", { name: /Equipment/ }));
    expect(screen.getByRole("tab", { name: /Equipment/ }).getAttribute("aria-selected")).toBe("true");
  });
});

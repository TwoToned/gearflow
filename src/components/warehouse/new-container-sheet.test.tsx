// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Radix Popover (ComboboxPicker) + Dialog (Sheet) need pointer-capture/scrollIntoView
// shims in jsdom — same footgun as combobox-picker.smoke.test.tsx.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const createMock = vi.fn(async () => ({ id: "c1", lineItemId: "li1" }));

vi.mock("convex/react", () => ({ useQuery: vi.fn(() => []) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-project-container-writes", () => ({
  useProjectContainerWrites: () => ({ create: createMock }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewContainerSheet } from "./new-container-sheet";

describe("NewContainerSheet smoke", () => {
  it("renders without throwing when open", () => {
    expect(() =>
      render(
        <NewContainerSheet
          open
          onOpenChange={() => {}}
          projectId="p1"
          existingContainers={[]}
          onCreated={() => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("New container")).toBeTruthy();
  });

  it("Custom tab: creates a container from a typed label", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <NewContainerSheet
        open
        onOpenChange={() => {}}
        projectId="p1"
        existingContainers={[]}
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Custom" }));
    await user.type(screen.getByLabelText("Label"), "Cardboard box 1");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "CUSTOM", label: "Cardboard box 1", projectId: "p1" }),
    ));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "c1", lineItemId: "li1", label: "Cardboard box 1" }));
  });

  it("the Bulk tub tab is disabled (D2 — deferred)", () => {
    render(
      <NewContainerSheet
        open
        onOpenChange={() => {}}
        projectId="p1"
        existingContainers={[]}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Bulk tub" }).hasAttribute("disabled")).toBe(true);
  });
});

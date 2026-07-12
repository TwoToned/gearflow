// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { MoveItemToGroupDialog } from "../move-item-to-group-dialog";
import type { CategoryData } from "../equipment-rows";

const baseProps = {
  lineItemId: "li1",
  isPending: false,
  onClose: () => {},
};

describe("MoveItemToGroupDialog — can move into uncategorized-zone groups (issue #4)", () => {
  it("offers an uncategorized group as a target and submits categoryId=null", () => {
    const onSubmit = vi.fn();
    // The ONLY groups in this project live in the Uncategorized zone (no category).
    render(
      <MoveItemToGroupDialog
        {...baseProps}
        categories={[] as unknown as CategoryData[]}
        uncategorizedGroups={[{ id: "g_orphan", title: "Staging" }]}
        onSubmit={onSubmit}
      />,
    );

    // Not the "no groups exist" empty state — the picker + Move button render.
    expect(screen.queryByText(/no groups in this project yet/i)).toBeNull();
    const option = screen.getByRole("option", { name: /Uncategorized > Staging/ }) as HTMLOptionElement;
    expect(option.value).toBe("g_orphan");

    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));
    expect(onSubmit).toHaveBeenCalledWith("li1", { categoryId: null, groupId: "g_orphan" });
  });

  it("lists both categorized and uncategorized groups together", () => {
    render(
      <MoveItemToGroupDialog
        {...baseProps}
        categories={[
          { id: "cat1", name: "Lighting", groups: [{ id: "g1", title: "Front Truss" }] },
        ] as unknown as CategoryData[]}
        uncategorizedGroups={[{ id: "g_orphan", title: "Staging" }]}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole("option", { name: /Lighting > Front Truss/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Uncategorized > Staging/ })).toBeTruthy();
  });
});

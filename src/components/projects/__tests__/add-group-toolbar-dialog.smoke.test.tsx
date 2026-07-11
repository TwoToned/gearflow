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

import { AddGroupToolbarDialog } from "../add-group-toolbar-dialog";

const baseProps = {
  open: true,
  isPending: false,
  categories: [{ id: "cat1", name: "Lighting" }],
  templates: [],
  onOpenChange: () => {},
};

describe("AddGroupToolbarDialog — defaults to Uncategorized (issue #5)", () => {
  it("enables Create with just a title (no category pick required) and submits categoryId=null", () => {
    const onSubmit = vi.fn();
    render(<AddGroupToolbarDialog {...baseProps} onSubmit={onSubmit} />);

    // The category select defaults to Uncategorized (not an empty "Select…").
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("__uncategorized__");
    // No empty placeholder option remains.
    expect(screen.queryByRole("option", { name: /select category/i })).toBeNull();

    // Type a title only — Create should already be enabled (no category step).
    fireEvent.change(screen.getByPlaceholderText(/PA System/i), {
      target: { value: "New Rig" },
    });
    const create = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);

    fireEvent.click(create);
    expect(onSubmit).toHaveBeenCalledWith({ categoryId: null, title: "New Rig", templateId: undefined });
  });
});

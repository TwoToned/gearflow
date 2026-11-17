// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeleteCategoryDialog } from "./delete-category-dialog";
import { categoryDeleteBody, categoryDeleteImpact } from "@/lib/category-delete-impact";

const cat = {
  id: "c1",
  name: "Lighting",
  lineItems: [{}, {}],
  groups: [
    { title: "Wash", price: 500, lineItems: [{}, {}, {}] },
    { title: "Free", price: 0, lineItems: [] },
  ],
};

describe("category delete impact", () => {
  it("counts loose + group members, groups, and only real bundle prices", () => {
    expect(categoryDeleteImpact(cat)).toEqual({ lineCount: 5, groupCount: 2, bundleTotal: 500 });
    expect(categoryDeleteImpact({ name: "x", groups: [] })).toEqual({ lineCount: 0, groupCount: 0, bundleTotal: null });
  });
  it("says groups are deleted and lines move", () => {
    const text = categoryDeleteBody(categoryDeleteImpact(cat)).join(" ");
    expect(text).toContain("5 lines will move to Uncategorized");
    expect(text).toContain("2 groups will be deleted");
  });
});

describe("DeleteCategoryDialog", () => {
  it("opens with the downstream text; Cancel does nothing, confirm deletes by id", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DeleteCategoryDialog category={cat} isPending={false} onClose={onClose} onConfirm={onConfirm} />);
    expect(await screen.findByText(/will move to Uncategorized/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete category" }));
    expect(onConfirm).toHaveBeenCalledWith("c1");
  });
  it("renders nothing when closed", () => {
    render(<DeleteCategoryDialog category={null} isPending={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

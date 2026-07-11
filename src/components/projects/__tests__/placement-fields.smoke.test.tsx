// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { PlacementFields } from "../placement-fields";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const categories = [
  { id: "c1", name: "Audio", sortOrder: 0, groups: [{ id: "g1", title: "PA System" }] },
] as any;

describe("PlacementFields — shared Category + Group box (issue #1)", () => {
  it("renders both a Category and a Group picker with the Uncategorized/No-group defaults", () => {
    render(
      <PlacementFields categories={categories} categoryId="" groupId="" onChange={() => {}} />,
    );
    expect(screen.getByText("Category")).toBeTruthy();
    expect(screen.getByText("Group")).toBeTruthy();
    // Defaults shown by the explicit SelectValue children.
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(screen.getByText("No group")).toBeTruthy();
  });

  it("disables the Group picker until a category is chosen, and enables it once set", () => {
    const { rerender } = render(
      <PlacementFields categories={categories} categoryId="" groupId="" onChange={() => {}} />,
    );
    // Two Select triggers render as comboboxes; the Group one (2nd) is disabled.
    let triggers = screen.getAllByRole("combobox") as HTMLButtonElement[];
    expect(triggers).toHaveLength(2);
    expect(triggers[1].disabled).toBe(true);

    rerender(
      <PlacementFields categories={categories} categoryId="c1" groupId="" onChange={() => {}} />,
    );
    triggers = screen.getAllByRole("combobox") as HTMLButtonElement[];
    expect(triggers[1].disabled).toBe(false);
    // Category now reflects the chosen category label.
    expect(screen.getByText("Audio")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ComboboxPicker is built on Radix Popover (NOT Base UI). Radix uses
// pointer-capture + scrollIntoView, which jsdom doesn't implement. Shim them so
// the popover mounts.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const OPTIONS = [
  { value: "alice", label: "Alice" },
  { value: "bob", label: "Bob" },
];

describe("ComboboxPicker smoke", () => {
  it("renders the trigger without throwing", () => {
    expect(() =>
      render(<ComboboxPicker value="" onChange={() => {}} options={OPTIONS} placeholder="Pick someone" />),
    ).not.toThrow();
    expect(screen.getByText("Pick someone")).toBeTruthy();
  });

  it("opens on click and selecting an option fires onChange", async () => {
    const onChange = vi.fn();
    render(<ComboboxPicker value="" onChange={onChange} options={OPTIONS} placeholder="Pick someone" />);

    fireEvent.click(screen.getByRole("button"));
    const option = await waitFor(() => screen.getByText("Bob"));
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("bob");
  });

  it("'Create new' action is live", async () => {
    const onCreateNew = vi.fn();
    render(
      <ComboboxPicker
        value=""
        onChange={() => {}}
        options={OPTIONS}
        onCreateNew={onCreateNew}
        createNewLabel="Add supplier"
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    const create = await waitFor(() => screen.getByText("Add supplier"));
    fireEvent.click(create);

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  // The regression that motivated the Base-UI→Radix rewrite: the picker lives
  // inside a Radix modal Dialog. A Base UI popover portaled to <body> inherited
  // the dialog's `pointer-events: none` lock and every click was swallowed.
  // Keeping the picker on Radix puts its popup in the same layer stack, so
  // options remain clickable inside a dialog.
  it("options are selectable while inside a Radix Dialog", async () => {
    const onChange = vi.fn();
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <ComboboxPicker value="" onChange={onChange} options={OPTIONS} placeholder="Pick crew" />
        </DialogContent>
      </Dialog>,
    );

    // The trigger is the picker's button (the dialog's close button has an
    // accessible name, so target by the placeholder text instead).
    fireEvent.click(screen.getByText("Pick crew"));
    const option = await waitFor(() => screen.getByText("Alice"));
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("alice");
  });

  // Phase 7 — async/server-search mode (onSearchChange).
  describe("async search mode", () => {
    it("reports the search term and does NOT filter options itself", async () => {
      const onSearchChange = vi.fn();
      // In async mode the parent supplies already-filtered options, so BOTH are
      // shown regardless of the typed term (no internal JS filter).
      render(
        <ComboboxPicker
          value=""
          onChange={() => {}}
          options={OPTIONS}
          onSearchChange={onSearchChange}
          placeholder="Search"
        />,
      );
      // Mount effect reports the initial (empty) term.
      expect(onSearchChange).toHaveBeenCalledWith("");

      fireEvent.click(screen.getByRole("button"));
      const input = await waitFor(() => screen.getByPlaceholderText("Search..."));
      fireEvent.change(input, { target: { value: "zzz" } });

      expect(onSearchChange).toHaveBeenLastCalledWith("zzz");
      // Both parent-supplied options remain visible (no client-side filtering).
      expect(screen.getByText("Alice")).toBeTruthy();
      expect(screen.getByText("Bob")).toBeTruthy();
    });

    it("shows the selectedLabel fallback when the value isn't in options", () => {
      render(
        <ComboboxPicker
          value="missing-id"
          onChange={() => {}}
          options={[]}
          onSearchChange={() => {}}
          selectedLabel="Chosen Supplier"
        />,
      );
      expect(screen.getByText("Chosen Supplier")).toBeTruthy();
    });

    it("shows a Searching… affordance while loading with no results", async () => {
      render(
        <ComboboxPicker
          value=""
          onChange={() => {}}
          options={[]}
          onSearchChange={() => {}}
          loading
          placeholder="Search"
        />,
      );
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(screen.getByText("Searching…")).toBeTruthy());
    });
  });
});

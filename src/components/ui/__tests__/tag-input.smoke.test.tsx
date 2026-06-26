// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { TagInput } from "@/components/ui/tag-input";
import { Dialog, DialogContent } from "@/components/ui/dialog";

describe("TagInput smoke", () => {
  it("typing shows a suggestion and clicking it adds the tag", async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} suggestions={["fragile", "heavy"]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "fra" } });
    const suggestion = await waitFor(() => screen.getByText("fragile"));
    // The dropdown uses onMouseDown (keeps input focus) rather than onClick.
    fireEvent.mouseDown(suggestion);

    expect(onChange).toHaveBeenCalledWith(["fragile"]);
  });

  // Regression: the suggestion dropdown used to be a raw body portal that was
  // unclickable inside a Radix modal Dialog (pointer-events lock) and would
  // close the dialog when clicked. On Radix Popover it works inside a dialog.
  it("suggestions are selectable while inside a Radix Dialog", async () => {
    const onChange = vi.fn();
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <TagInput value={[]} onChange={onChange} suggestions={["fragile", "heavy"]} />
        </DialogContent>
      </Dialog>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hea" } });
    const suggestion = await waitFor(() => screen.getByText("heavy"));
    fireEvent.mouseDown(suggestion);

    expect(onChange).toHaveBeenCalledWith(["heavy"]);
  });
});

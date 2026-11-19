// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import type { LineRowListSection } from "@/components/ui/line-row";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { useRowHotkeys } from "./use-row-hotkeys";

const edit = vi.fn();
const move = vi.fn();
const del = vi.fn();
const sections: LineRowListSection[] = [
  {
    section: { id: "s", title: "S" },
    rows: [
      {
        id: "r1",
        kind: "gear",
        title: "R1",
        facts: {},
        menu: {
          items: [
            { key: "edit", label: "Edit", group: "edit", kbd: "E", onSelect: edit },
            { key: "move", label: "Move", group: "organise", kbd: "M", onSelect: move },
            {
              key: "delete",
              label: "Delete",
              group: "danger",
              kbd: "D",
              danger: true,
              onSelect: del,
              confirm: { title: "Delete R1?", body: "Removes it.", confirmLabel: "Delete line" },
            },
          ],
        },
      },
    ],
  },
];

function H({ scope = true }: { scope?: boolean }) {
  const h = useRowHotkeys(sections);
  return (
    <div data-shortcut-scope={scope ? "equipment" : undefined}>
      <div {...h.handlers}>
        <div data-row-id="r1">row</div>
      </div>
      <ConfirmDialog item={h.pending} onClose={h.clearPending} />
      <input data-testid="in" />
    </div>
  );
}

describe("useRowHotkeys", () => {
  it("runs the hovered row's E / M menu items, and nothing when not hovering or typing", () => {
    const { getByText, getByTestId } = render(<H />);
    fireEvent.keyDown(window, { key: "e" });
    expect(edit).not.toHaveBeenCalled();
    fireEvent.mouseOver(getByText("row"));
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "m" });
    fireEvent.keyDown(window, { key: "x" });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    getByTestId("in").focus();
    fireEvent.keyDown(window, { key: "e" });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("D opens the confirm dialog and only deletes on its confirm button", async () => {
    const { getByText, findByRole } = render(<H />);
    fireEvent.mouseOver(getByText("row"));
    fireEvent.keyDown(window, { key: "d" });
    expect(del).not.toHaveBeenCalled();
    expect(await findByRole("dialog")).toBeTruthy();
    fireEvent.click(getByText("Delete line"));
    expect(del).toHaveBeenCalledTimes(1);
  });
});

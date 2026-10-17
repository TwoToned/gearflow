// @vitest-environment jsdom
//
// "Print one label" submenu (FEATUREDOCS/83). Per CLAUDE.md's dropdown rule this
// OPENS the menu and the submenu rather than asserting on a closed trigger: the
// per-label entries only exist after the label list has been fetched.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LabelSubmenu } from "../label-submenu";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const open = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", open);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function reply(labels: Array<{ id: string; title: string; tag: string | null }>) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ labels }) });
}

async function openSubmenu(label: string) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Docs</DropdownMenuTrigger>
      <DropdownMenuContent>
        <LabelSubmenu projectId="p1" apiType="kit-label" label={label} allLabel="All kits" emptyLabel="No kits on this job" />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByText("Docs");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  const sub = await screen.findByText(label);
  sub.focus();
  fireEvent.keyDown(sub, { key: "ArrowRight" });
}

describe("LabelSubmenu", () => {
  it("lists each label the job would print and opens just that one", async () => {
    reply([{ id: "kit-line-1", title: "RF Kit 1", tag: "TTP00077" }]);
    await openSubmenu("Kit labels");
    fireEvent.click(await screen.findByText("RF Kit 1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/p1?type=kit-label&list=1", expect.anything());
    expect(open).toHaveBeenCalledWith("/api/documents/p1?type=kit-label&labelId=kit-line-1", "_blank");
  });

  it("prints everything from the All entry", async () => {
    reply([{ id: "kit-line-1", title: "RF Kit 1", tag: null }]);
    await openSubmenu("Kit labels");
    fireEvent.click(await screen.findByText("All kits"));
    expect(open).toHaveBeenCalledWith("/api/documents/p1?type=kit-label", "_blank");
  });

  it("says so, with nothing to print, when the job has none", async () => {
    reply([]);
    await openSubmenu("Kit labels");
    await waitFor(() => expect(screen.getByText("No kits on this job")).toBeTruthy());
    expect(screen.queryByText("All kits")).toBeNull();
  });
});

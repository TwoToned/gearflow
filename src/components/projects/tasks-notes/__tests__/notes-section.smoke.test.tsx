// @vitest-environment jsdom
//
// UX Phase 10 (spec §8c): the Notes section renders three cards with their AUDIENCE on
// the label, saves on blur / ⌘↵, derives its `Saved · who · date` line from the activity
// read, previews client notes, and opens the version menu. The real components render;
// only data reads, the version context and the permission hook are stubbed.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

let viewer = false;
let isViewingVersion = false;
const versions = [
  { id: "v2", number: 2, label: "Revised", isLive: true },
  { id: "v1", number: 1, label: null, isLive: false },
];
vi.mock("@/lib/use-permissions", () => ({ useIsViewer: () => viewer }));
vi.mock("@/components/projects/project-version-context", () => ({
  useProjectVersion: () => ({ versions, isViewingVersion, viewingVersion: null }),
}));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (q: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(q);
      if (name === "collaboration:lastNoteSaves") return { clientNotes: { by: "Sam", at: Date.UTC(2026, 10, 6, 12) } };
      if (name === "versionsRead:getVersion") return { planFields: { clientNotes: "Old v1 client note" } };
      return undefined;
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NotesSection } from "@/components/projects/tasks-notes/notes-section";

const composed = { clientNotes: "Hello **world**", crewNotes: "Load in 7am", internalNotes: "" };

beforeEach(() => {
  viewer = false;
  isViewingVersion = false;
});

describe("NotesSection", () => {
  it("shows three cards with the audience on the label, and Saved line only where a save exists", () => {
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={vi.fn()} />);
    expect(screen.getByLabelText("Client notes · prints on the quote & invoice")).toBeTruthy();
    expect(screen.getByLabelText("Crew notes · prints on the call sheet & runsheet")).toBeTruthy();
    expect(screen.getByLabelText("Internal notes · only us · never printed")).toBeTruthy();
    expect(screen.getAllByText(/^Saved · Sam · /)).toHaveLength(1);
  });

  it("saves on blur with the typed text, and not when nothing changed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={onSave} />);
    const crew = screen.getByLabelText(/^Crew notes/);
    await user.click(crew);
    await user.tab(); // blur with no edit
    expect(onSave).not.toHaveBeenCalled();
    await user.click(crew);
    await user.type(crew, " and gaffer");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    await user.tab();
    expect(onSave).toHaveBeenCalledWith("crewNotes", "Load in 7am and gaffer");
  });

  it("saves on ⌘↵ / Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={onSave} />);
    const internal = screen.getByLabelText(/^Internal notes/);
    await user.click(internal);
    await user.type(internal, "Keys with Pat");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSave).toHaveBeenCalledWith("internalNotes", "Keys with Pat");
  });

  it("Preview renders the client notes the way the documents print them", async () => {
    const user = userEvent.setup();
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByLabelText("Preview of what the documents print");
    expect(within(preview).getByText("world").tagName).toBe("STRONG");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(/^Client notes/)).toBeTruthy();
  });

  it("the version menu opens and an earlier version's notes are read-only", async () => {
    const user = userEvent.setup();
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /v2 · live/ }));
    await user.click(await screen.findByRole("menuitem", { name: /^v1/ }));
    expect(screen.getByText("Old v1 client note")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/read-only/)).toBeTruthy();
  });

  it("a viewer sees the text and no editor", () => {
    viewer = true;
    render(<NotesSection projectId="p1" orgId="org1" composed={composed} onSave={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Load in 7am")).toBeTruthy();
  });
});

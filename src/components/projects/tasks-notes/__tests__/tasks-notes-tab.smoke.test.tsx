// @vitest-environment jsdom
//
// UX Phase 10: `?tab=notes|files|discussion|tasks` all land on the ONE Tasks & notes tab
// and scroll to their section; the phone's chip row jumps to each. The four sections are
// stubbed so this tests only the tab's own scroll wiring.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/projects/tasks-notes/tasks-section", () => ({ TasksSection: () => <p>tasks body</p> }));
vi.mock("@/components/projects/tasks-notes/files-section", () => ({ FilesSection: () => <p>files body</p> }));
vi.mock("@/components/projects/tasks-notes/notes-section", () => ({ NotesSection: () => <p>notes body</p> }));
vi.mock("@/components/projects/tasks-notes/discussion-section", () => ({ DiscussionSection: () => <p>discussion body</p> }));
vi.mock("@/components/projects/version-not-tracked-note", () => ({ VersionNotTrackedNote: () => null }));

import { TasksNotesTab } from "@/components/projects/tasks-notes/tasks-notes-tab";

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.querySelector("h2")?.textContent ?? "?");
  };
});

const notes = { crewNotes: "", internalNotes: "", clientNotes: "" };
const tab = (section: "tasks" | "notes" | "files" | "discussion" | null) => (
  <TasksNotesTab projectId="p1" orgId="org1" section={section} composedNotes={notes} onSaveNote={vi.fn()} onOpenTab={vi.fn()} />
);

describe("TasksNotesTab", () => {
  it.each([
    ["notes", "Notes"],
    ["files", "Files"],
    ["discussion", "Discussion"],
    ["tasks", "Tasks"],
  ] as const)("a ?tab=%s deep link scrolls to the %s section", (section, heading) => {
    render(tab(section));
    expect(scrolled).toEqual([heading]);
  });

  it("with no section it scrolls nowhere, and the chip row jumps to a section", async () => {
    const user = userEvent.setup();
    render(tab(null));
    expect(scrolled).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(scrolled).toEqual(["Files"]);
  });
});

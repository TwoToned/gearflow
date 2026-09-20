// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

type CreateArg = {
  title: string; description?: string; projectId?: string;
  dueDate: string | null; startDate: string | null; priority?: string;
};
const create = vi.fn((_input: CreateArg) => Promise.resolve("task-1"));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u-me", name: "Ada" } } }),
}));
vi.mock("@/hooks/use-project-tasks-writes", () => ({
  useProjectTaskWrites: () => ({ create }),
}));
vi.mock("@/hooks/use-document-dates-config", () => ({
  useDocumentDatesConfig: () => ({ timezone: "Australia/Melbourne" }),
}));

import { WorkComposer } from "@/components/work/work-composer";

const assignees = {
  users: [{ id: "u-me", name: "Ada" }, { id: "u-ben", name: "Ben R." }],
  crew: [{ id: "c-1", firstName: "Cara", lastName: "Crew" }],
};

/**
 * The composer is only ever wrong at runtime: it is four Radix dropdowns and a
 * native date field, all of which typecheck whatever they do on screen. So the
 * two things this file pins are the two that shipped broken —
 *
 * 1. **The title input has its own row.** The one-row layout raced the input
 *    against four chips in a 340px rail and left it about forty pixels wide;
 *    you could not read what you were typing. The input and the chip row must
 *    not be siblings in one flex line.
 * 2. **A date can be set BEFORE Add.** The old project composer had no due
 *    control at all, so dating a task meant creating it and reopening it.
 */
describe("WorkComposer", () => {
  beforeEach(() => create.mockClear());

  it("keeps the title input out of the chips' flex row", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    const input = screen.getByLabelText("Add work");
    await user.type(input, "Load the truck");

    const addButton = screen.getByRole("button", { name: "Add" });
    // The row that lays out the chips must not also be laying out the input —
    // that shared flex line is the bug.
    expect(addButton.parentElement?.contains(input)).toBe(false);
    expect(input.parentElement?.contains(addButton)).toBe(false);
  });

  it("sets a due date from the composer, before the row is ever created", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Book the truck");
    await user.click(screen.getByLabelText("Dates: No date"));

    const dateField = await waitFor(() => screen.getByLabelText("Due on"));
    await user.clear(dateField);
    await user.type(dateField, "2026-10-12");

    await waitFor(() => expect(screen.getByLabelText(/^Dates: /).textContent).toMatch(/12/));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      title: "Book the truck",
      projectId: "p1",
      dueDate: "2026-10-12",
    });
  });

  it("offers a stage AND a date on a job — they are different questions", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);
    await user.type(screen.getByLabelText("Add work"), "Prep the rack");

    expect(screen.getByLabelText("Stage: No stage")).toBeTruthy();
    expect(screen.getByLabelText("Dates: No date")).toBeTruthy();
    expect(screen.getByLabelText("Priority: Normal")).toBeTruthy();
  });

  it("has no stage chip off a job — personal work has no stages", async () => {
    const user = userEvent.setup();
    render(<WorkComposer assignees={assignees} />);
    await user.type(screen.getByLabelText("Add work"), "Call the client");

    expect(screen.queryByLabelText(/^Stage: /)).toBeNull();
    expect(screen.getByLabelText("Dates: Today")).toBeTruthy();
  });

  it("sends a deliberate priority and omits the default one", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Chase the sub-hire");
    await user.click(screen.getByLabelText("Priority: Normal"));
    await user.click(await screen.findByRole("menuitem", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].priority).toBe("HIGH");
  });

  it("keeps the chips set after an add — five things for one stage is one intent", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "First");
    await user.click(screen.getByLabelText("Stage: No stage"));
    const stageItem = (await screen.findAllByRole("menuitem")).find((n) => n.textContent !== "No stage")!;
    const stageLabel = stageItem.textContent!;
    await user.click(stageItem);
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect((screen.getByLabelText("Add work") as HTMLInputElement).value).toBe(""));
    expect(screen.getByLabelText(`Stage: ${stageLabel}`)).toBeTruthy();
  });

  it("turns two dates into a span, and says so on the chip", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Build the set");
    await user.click(screen.getByLabelText("Dates: No date"));
    await user.type(await screen.findByLabelText("Due on"), "2026-10-14");
    // The start field only exists once there is a due date to run to.
    await user.type(await screen.findByLabelText("Starts on"), "2026-10-12");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ startDate: "2026-10-12", dueDate: "2026-10-14" });
  });

  it("offers no start date until there is a due date to run to", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Someday");
    await user.click(screen.getByLabelText("Dates: No date"));

    await waitFor(() => expect(screen.getByLabelText("Due on")).toBeTruthy());
    expect(screen.queryByLabelText("Starts on")).toBeNull();
  });

  // The Convex mutation rejects an inverted span too; this is the client half
  // so the user never round-trips a server error for something visible here.
  it("drops a start date that is after the due date rather than sending it", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Backwards");
    await user.click(screen.getByLabelText("Dates: No date"));
    await user.type(await screen.findByLabelText("Due on"), "2026-10-12");
    await user.type(await screen.findByLabelText("Starts on"), "2026-11-30");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ dueDate: "2026-10-12", startDate: null });
  });

  it("carries notes typed before Add, and clears them after", async () => {
    const user = userEvent.setup();
    render(<WorkComposer projectId="p1" assignees={assignees} />);

    await user.type(screen.getByLabelText("Add work"), "Collect the gear");
    await user.click(screen.getByLabelText("Notes: none"));
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), "Loading dock is round the back");
    await user.keyboard("{Escape}");

    // The chip shows it is carrying something, so notes can't be invisible.
    expect(screen.getByLabelText("Notes: added")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].description).toBe("Loading dock is round the back");
    await waitFor(() => expect(screen.getByLabelText("Notes: none")).toBeTruthy());
  });

  it("still refuses the nowhere case — no owner and no job", async () => {
    const user = userEvent.setup();
    render(<WorkComposer assignees={assignees} defaultOwner={{ kind: "nobody" }} />);

    await user.type(screen.getByLabelText("Add work"), "Into the void");
    expect(screen.getByText(/land nowhere/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });
});

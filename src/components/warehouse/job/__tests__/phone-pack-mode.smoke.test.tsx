// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { JobTable, jobRowIds } from "@/components/warehouse/job/job-table";
import { MovingStage } from "@/components/warehouse/job/moving-stage";
import type { JobSection } from "@/lib/warehouse-job-rows";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

const pack = vi.fn();
const sections: JobSection[] = [
  { key: "c1", section: { id: "c1", title: "LX-04", count: 1 }, rows: [
    {
      id: "a", kind: "gear", title: "Beltpack", tags: ["BP-01"], status: { label: "Packed", intent: "info" },
      facts: { qty: { kind: "qty", value: 2 }, place: { kind: "place", label: "LX-04" } },
      children: [
        { id: "acc1", kind: "accessory", title: "Antenna", tags: ["DEFAULT"], status: { label: "To pick", intent: "neutral" }, facts: { qty: { kind: "qty", value: 0, of: 2 } }, primary: { label: "Pack 2 with parent", onSelect: pack } },
      ],
    },
  ] },
];

function Harness() {
  const selection = useRowSelection(jobRowIds(sections));
  return <MovingStage sections={sections} selection={selection} empty={{ title: "e", description: "e" }} actions={[{ key: "deploy", label: "Deploy", primary: true, run: () => {} }]} />;
}

describe("phone pack mode (§9.4)", () => {
  it("a row tap opens the row sheet: accessories first with their own action, then the tick action", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Beltpack"));
    const sheet = await screen.findByTestId("job-row-sheet");
    const acc = within(sheet).getByRole("list", { name: "Accessories" });
    expect(within(acc).getByText("Antenna")).toBeTruthy();
    await userEvent.click(within(acc).getByRole("button", { name: "Pack 2 with parent" }));
    expect(pack).toHaveBeenCalled();
  });
  it("ticking from the sheet shows the sticky action bar (portaled to body) with the stage verb", async () => {
    render(<Harness />);
    expect(screen.queryByRole("toolbar", { name: "Stage actions" })).toBeNull();
    await userEvent.click(screen.getByText("Beltpack"));
    await userEvent.click(await screen.findByRole("button", { name: "Tick for the action bar" }));
    const bar = await screen.findByRole("toolbar", { name: "Stage actions" });
    expect(document.body.contains(bar)).toBe(true);
    expect(bar.closest(".fixed")).toBeTruthy(); // pinned above the bottom nav, not in the list's flow
    expect(within(bar).getByRole("button", { name: "Deploy (1)" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Clear selection" })).toBeTruthy();
  });
  it("JobTable alone opens the sheet on a row tap", async () => {
    function T() { const s = useRowSelection(jobRowIds(sections)); return <JobTable sections={sections} selection={s} />; }
    render(<T />);
    await userEvent.click(screen.getByText("Beltpack"));
    expect(await screen.findByTestId("job-row-sheet")).toBeTruthy();
  });
});

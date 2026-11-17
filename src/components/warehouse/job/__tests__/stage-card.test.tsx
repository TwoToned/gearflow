// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StageCard, stageOptions, dockConfigFor, stageFromParams } from "@/components/warehouse/job/stage-card";
import { CaseChips, nextCaseChoice } from "@/components/warehouse/job/case-chips";

vi.mock("@/components/scanner/scan-button", () => ({ ScanButton: () => <button type="button">Camera</button> }));

const counts = { pick: 18, prepped: 24, out: 0, returned: 0, deprepped: 3 };

describe("stageFromParams", () => {
  const p = (q: string) => new URLSearchParams(q);
  it("?stage= wins, ?tab= aliases onto it, default is To pick", () => {
    expect(stageFromParams(p("stage=returned&tab=check-in"))).toBe("returned");
    expect(stageFromParams(p("tab=check-in"))).toBe("out");
    expect(stageFromParams(p("tab=check-out"))).toBe("prepped");
    expect(stageFromParams(p("tab=close-out"))).toBe("closeout");
    expect(stageFromParams(p("stage=bogus"))).toBe("pick");
    expect(stageFromParams(p(""))).toBe("pick");
  });
});

describe("stage card", () => {
  it("words and counts come from the vocabulary; Close-out is the sixth", () => {
    expect(stageOptions(counts).map((o) => `${o.label} ${o.count}`)).toEqual(["To pick 18", "Prepped 24", "Out 0", "Returned 0", "De-prepped 3", "Close-out 0"]);
  });
  it("dock verb follows the stage", () => {
    expect(dockConfigFor("out").placeholder).toMatch(/receive/);
    expect(dockConfigFor("returned").modes[0].label).toBe("De-prep as I scan");
  });
  it("clicking a stage word changes the stage; the dock scans through onScan", async () => {
    const onStage = vi.fn(); const onScan = vi.fn();
    render(<StageCard stage="pick" counts={counts} onStageChange={onStage} onScan={onScan} mode="prep" onModeChange={() => {}} entries={[{ id: "1", tone: "error", text: "Not on this job" }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Prepped/ }));
    expect(onStage).toHaveBeenCalledWith("prepped");
    await userEvent.type(screen.getByLabelText("Scan input"), "SM-1{Enter}");
    expect(onScan).toHaveBeenCalledWith("SM-1");
    expect(screen.getByText("Not on this job")).toBeTruthy();
  });
  it("Close-out hides the dock", () => {
    render(<StageCard stage="closeout" counts={counts} onStageChange={() => {}} onScan={() => {}} mode="prep" onModeChange={() => {}} entries={[]} />);
    expect(screen.queryByLabelText("Scan input")).toBeNull();
  });
});

describe("case chips", () => {
  it("click-again-to-clear (2c): active clears to undefined, Loose is null", () => {
    expect(nextCaseChoice("c1", "c1")).toBeUndefined();
    expect(nextCaseChoice(undefined, "c1")).toBe("c1");
    expect(nextCaseChoice(undefined, null)).toBeNull();
    expect(nextCaseChoice(null, null)).toBeUndefined();
  });
  it("a sealed case cannot be made active; the active chip is pressed", async () => {
    const onChoose = vi.fn();
    render(<CaseChips cases={[{ id: "c1", label: "LX-04", packed: 3 }, { id: "c2", label: "VID-01", packed: 9, sealed: true }]} choice="c1" onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: /LX-04/ }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: /VID-01/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /LX-04/ }));
    expect(onChoose).toHaveBeenCalledWith(undefined);
  });
});

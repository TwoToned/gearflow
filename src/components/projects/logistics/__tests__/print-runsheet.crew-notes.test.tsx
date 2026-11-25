// @vitest-environment jsdom
//
// UX Phase 10 (spec §8c): crew notes print at the top of the runsheet, as the same
// plain lines the call sheet prints, and nothing is added when there are none.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrintRunsheet } from "@/components/projects/logistics/print-runsheet";
import type { LogisticsService } from "@/lib/logistics-model";
import { crewNotesLines } from "@/lib/crew-notes-print";

const site = { venue: "Town Hall", address: "", access: "", contactName: "", contactPhone: "", contactEmail: "" };
const services = [
  { id: "s1", title: "Bump in", status: "PLANNED", date: "2026-11-10", startTime: "07:00", endTime: "09:00", notes: "", crewAssignments: [] },
] as unknown as LogisticsService[];

describe("crewNotesLines", () => {
  it("strips markers, converts bullets, trims blank ends", () => {
    expect(crewNotesLines("\n**Load in** at 7am\n- bring ear defenders\n\n")).toEqual(["Load in at 7am", "• bring ear defenders"]);
    expect(crewNotesLines("- a", "- ")).toEqual(["- a"]);
    expect(crewNotesLines("   ")).toEqual([]);
    expect(crewNotesLines(undefined)).toEqual([]);
  });
});

describe("PrintRunsheet crew notes", () => {
  it("prints a Crew notes block above the days", () => {
    render(<PrintRunsheet title="Gala" services={services} site={site} crewNotes={"**Load in** at 7am\n- bring ear defenders"} />);
    const block = screen.getByTestId("print-runsheet-crew-notes");
    expect(block.textContent).toContain("Crew notes");
    expect(block.textContent).toContain("Load in at 7am");
    expect(block.textContent).toContain("• bring ear defenders");
    expect(block.textContent).not.toContain("**");
    const sheet = screen.getByTestId("print-runsheet");
    expect(sheet.textContent!.indexOf("Crew notes")).toBeLessThan(sheet.textContent!.indexOf("Bump in"));
  });

  it("prints no block without notes", () => {
    render(<PrintRunsheet title="Gala" services={services} site={site} crewNotes="" />);
    expect(screen.queryByTestId("print-runsheet-crew-notes")).toBeNull();
    expect(screen.getByText("Bump in")).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
import { expandSectionsForDates } from "./generate-pdf";
import type { TemplateSection } from "./section-types";
import type { CallSheetDayData, DocumentData, CrewEntry } from "./types";

function makeCrewEntry(name: string): CrewEntry {
  return {
    name,
    role: "Tech",
    phase: null,
    callTime: "09:00",
    endTime: "18:00",
    phone: null,
    email: null,
    notes: null,
    status: "CONFIRMED",
    department: null,
    breakMinutes: null,
    shiftLocation: null,
    shiftNotes: null,
    isProjectManager: false,
  };
}

function makeSection(
  type: TemplateSection["type"],
  id?: string,
): TemplateSection {
  return {
    id: id || `sec-${type}`,
    type,
    settings: {},
    visibility: {},
    order: 0,
  };
}

const stubData = { org_document_color: "#0d4f4f" } as DocumentData;

describe("expandSectionsForDates", () => {
  it("returns sections unchanged when no crew-table sections exist", () => {
    const sections = [makeSection("header"), makeSection("notes")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: [], crew: [makeCrewEntry("A")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("header");
    expect(result[1].type).toBe("notes");
  });

  it("expands crew-table for multiple days with day-headers", () => {
    const sections = [makeSection("header"), makeSection("crew-table"), makeSection("notes")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: ["BUMP_IN"], crew: [makeCrewEntry("A")] },
      { date: "2026-04-08", dayLabel: "Tuesday, 8 April", phases: ["EVENT"], crew: [makeCrewEntry("B")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    // header + (day-header + crew-table) * 2 + notes = 6
    expect(result).toHaveLength(6);
    expect(result[0].type).toBe("header");
    expect(result[1].type).toBe("day-header");
    expect(result[2].type).toBe("crew-table");
    expect(result[3].type).toBe("day-header");
    expect(result[4].type).toBe("crew-table");
    expect(result[5].type).toBe("notes");
  });

  it("skips day-header for single-date expansion", () => {
    const sections = [makeSection("crew-table")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: [], crew: [makeCrewEntry("A")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    // Single day: no day-header, just the crew-table
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("crew-table");
  });

  it("skips days with no crew (non-unscheduled)", () => {
    const sections = [makeSection("crew-table")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: [], crew: [makeCrewEntry("A")] },
      { date: "2026-04-08", dayLabel: "Tuesday, 8 April", phases: [], crew: [] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    // Only one day has crew, but multi-day so day-header is included
    expect(result).toHaveLength(2); // day-header + crew-table
    expect(result[0].type).toBe("day-header");
    expect(result[1].type).toBe("crew-table");
  });

  it("includes unscheduled group even with empty crew", () => {
    const sections = [makeSection("crew-table")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: [], crew: [makeCrewEntry("A")] },
      { date: "", dayLabel: "Unscheduled", phases: [], crew: [] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    // Both days produce day-header + crew-table
    expect(result).toHaveLength(4);
    expect(result[2].type).toBe("day-header");
    expect(result[3].type).toBe("crew-table");
  });

  it("sets dayCrew override in crew-table content", () => {
    const crew = [makeCrewEntry("A"), makeCrewEntry("B")];
    const sections = [makeSection("crew-table")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday", phases: [], crew },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    const crewTable = result[0];
    const parsed = JSON.parse(crewTable.content!);
    expect(parsed.dayCrew).toHaveLength(2);
    expect(parsed.dayCrew[0].name).toBe("A");
  });

  it("sets day-header content with config JSON", () => {
    const sections = [makeSection("crew-table")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday, 7 April", phases: ["BUMP_IN"], crew: [makeCrewEntry("A")] },
      { date: "2026-04-08", dayLabel: "Tuesday, 8 April", phases: [], crew: [makeCrewEntry("B")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    const dayHeader = result[0];
    expect(dayHeader.type).toBe("day-header");
    const config = JSON.parse(dayHeader.content!);
    expect(config.dayLabel).toBe("Monday, 7 April");
    expect(config.phases).toEqual(["BUMP_IN"]);
    expect(config.crewCount).toBe(1);
    expect(config.documentColor).toBe("#0d4f4f");
  });

  it("handles multiple crew-table sections (clones all per day)", () => {
    const sections = [
      makeSection("crew-table", "ct-1"),
      makeSection("header"),
      makeSection("crew-table", "ct-2"),
    ];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday", phases: [], crew: [makeCrewEntry("A")] },
      { date: "2026-04-08", dayLabel: "Tuesday", phases: [], crew: [makeCrewEntry("B")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    // day1: day-header + ct-1 + ct-2, day2: day-header + ct-1 + ct-2, then header
    expect(result).toHaveLength(7);
    expect(result[0].type).toBe("day-header");
    expect(result[1].type).toBe("crew-table");
    expect(result[2].type).toBe("crew-table");
    expect(result[3].type).toBe("day-header");
    expect(result[4].type).toBe("crew-table");
    expect(result[5].type).toBe("crew-table");
    expect(result[6].type).toBe("header");
  });

  it("assigns unique ids to expanded sections", () => {
    const sections = [makeSection("crew-table", "ct-main")];
    const days: CallSheetDayData[] = [
      { date: "2026-04-07", dayLabel: "Monday", phases: [], crew: [makeCrewEntry("A")] },
      { date: "2026-04-08", dayLabel: "Tuesday", phases: [], crew: [makeCrewEntry("B")] },
    ];
    const result = expandSectionsForDates(sections, days, stubData);

    const ids = result.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

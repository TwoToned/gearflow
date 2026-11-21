import { describe, expect, it } from "vitest";
import { timesheetCsv, type TimesheetCsvRow } from "./timesheet-csv";

const row = (over: Partial<TimesheetCsvRow> = {}): TimesheetCsvRow => ({
  name: "Bob Ryan", email: "bob@x.com", projectNumber: "2341", projectName: "Launch", role: "Rigger", description: "",
  date: "2026-11-16", startTime: "07:00", endTime: "12:00", breakMinutes: 0, totalHours: 5, status: "DISPUTED", queryReason: "Was it 4h?",
  ...over,
});

describe("timesheetCsv", () => {
  it("keeps the twelve original columns and the raw status enum, then appends Query reason", () => {
    const [header, line] = timesheetCsv([row()], false).split("\n");
    expect(header.split(",").slice(0, 12)).toEqual(["Crew Member", "Email", "Project Number", "Project Name", "Role", "Description", "Date", "Start Time", "End Time", "Break (min)", "Total Hours", "Status"]);
    expect(header.endsWith(",Query reason")).toBe(true);
    expect(line).toContain(",DISPUTED,Was it 4h?");
    expect(header).not.toContain("Rate");
  });

  it("adds Rate (pay) and Total only when the server cleared pay; an included day rate prints incl.", () => {
    const csv = timesheetCsv([row({ pay: { rate: 650, total: 650, included: false } }), row({ pay: { rate: 650, total: null, included: true } }), row()], true);
    const lines = csv.split("\n");
    expect(lines[0].endsWith(",Rate (pay),Total")).toBe(true);
    expect(lines[1].endsWith(",650,650")).toBe(true);
    expect(lines[2].endsWith(",650,incl.")).toBe(true);
    expect(lines[3].endsWith(",,")).toBe(true); // no rate resolved: blank, not $0
  });

  it("guards formula injection through src/lib/csv.ts", () => {
    const csv = timesheetCsv([row({ description: "=HYPERLINK(\"x\")", queryReason: "+1" })], false);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(",'+1");
  });
});

/**
 * UX Phase 10 (spec §8c): the job's crew notes print at the top of the call sheet.
 * Pipeline test: the REAL template builder + pdfme render + `pdf-parse` text
 * extraction; only the Convex-backed readers are stubbed with a realistic fixture
 * (services across days, crew with roles, enough rows to paginate).
 */
import { describe, it, expect, vi } from "vitest";
import { PDFParse } from "pdf-parse";

const DATA = {
  org_name: "Acme AV",
  org_phone: "",
  org_email: "",
  org_logo: "",
  org_icon: "",
  org_document_color: "#d62718",
  project_number: "P-100",
  document_date: "6 Nov 2026",
  project_name: "Annual Gala",
  client_name: "Big Client",
  rental_start: "-",
  rental_end: "-",
  event_start: "-",
  event_end: "-",
  venue_name: "Town Hall",
  venue_address: "1 Main St",
  site_contact_name: "",
  site_contact_phone: "",
  crew_notes: "",
};
let crewNotes = "";
vi.mock("../build-document-data", () => ({ buildDocumentData: async () => ({ ...DATA, crew_notes: crewNotes }) }));

const services = Array.from({ length: 40 }, (_, i) => ({
  id: `s${i}`,
  date: new Date(Date.UTC(2026, 10, 10 + (i % 3))),
  title: `Service ${i}`,
  type: "LABOUR",
  status: "PLANNED",
  startTime: "07:00",
  endTime: "17:00",
  notes: "",
  clientContactName: null,
  clientContactPhone: null,
  clientVehicle: null,
}));
vi.mock("@/lib/project-service-read", () => ({ getProjectServicesFromConvex: async () => services }));
vi.mock("@/lib/crew-scheduling-read", () => ({
  getAssignmentsByProject: async () => services.map((s, i) => ({ serviceId: s.id, crewMemberId: `c${i % 4}`, crewRoleId: "r1", status: "CONFIRMED" })),
}));
vi.mock("@/lib/crew-read", () => ({
  getCrewMemberMap: async () => new Map([0, 1, 2, 3].map((i) => [`c${i}`, { firstName: `Crew${i}`, lastName: "Member", phone: null }])),
  getCrewRoleMap: async () => new Map([["r1", { name: "Tech" }]]),
}));

import { buildCallSheetFromServices, crewNotesBlock } from "./call-sheet-services";

async function pagesOf(): Promise<string[]> {
  const bytes = await buildCallSheetFromServices("p1", "org1", {});
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).pages.map((p) => p.text);
  } finally {
    await parser.destroy();
  }
}

describe("crewNotesBlock", () => {
  it("is null for empty / whitespace notes, so the sheet is unchanged", () => {
    expect(crewNotesBlock("")).toBeNull();
    expect(crewNotesBlock("  \n ")).toBeNull();
    expect(crewNotesBlock(null)).toBeNull();
  });

  it("strips markdown markers, turns bullets to '- ' (Helvetica only) and sizes the box", () => {
    const b = crewNotesBlock("**Load in** at 7am\n- bring ear defenders\n- park at the rear");
    expect(b?.content).toBe("CREW NOTES\nLoad in at 7am\n- bring ear defenders\n- park at the rear");
    expect(b?.height).toBe((3 + 1) * 4 + 2);
  });

  it("caps a very long note and points back to the job", () => {
    const b = crewNotesBlock(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    expect(b?.content).toContain("line 0");
    expect(b?.content).not.toContain("line 39");
    expect(b?.content).toContain("the rest is in the job's Crew notes");
  });
});

describe("call sheet pipeline", () => {
  it("prints the crew notes on page 1 and still prints every service row", async () => {
    crewNotes = "**Load in** at 7am\n- bring ear defenders";
    const pages = await pagesOf();
    expect(pages[0]).toContain("CREW NOTES");
    expect(pages[0]).toContain("Load in at 7am");
    expect(pages[0]).toContain("- bring ear defenders");
    expect(pages[0]).not.toContain("**");
    expect(pages.slice(1).join("\n")).not.toContain("CREW NOTES");
    const all = pages.join("\n");
    for (const s of services) expect(all).toContain(s.title);
  });

  it("without crew notes the sheet has no CREW NOTES block", async () => {
    crewNotes = "";
    const pages = await pagesOf();
    expect(pages.join("\n")).not.toContain("CREW NOTES");
    for (const s of services) expect(pages.join("\n")).toContain(s.title);
  });
});

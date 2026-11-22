// @vitest-environment node
import { describe, test, expect } from "vitest";
import { readinessVerdict } from "@/lib/job-readiness-verdict";
import { isPastPrep } from "@/lib/job-lifecycle";
import { buildReadinessChecks, type ReadinessCheck } from "@/lib/project-readiness-checks";

const pass = (id: ReadinessCheck["id"], title = `${id} ok`): ReadinessCheck => ({ id, severity: "pass", title });
const warn = (id: ReadinessCheck["id"]): ReadinessCheck => ({ id, severity: "warning", title: `${id} warn`, fix: { kind: "tab", tab: "labour" } });
const unknown = (id: ReadinessCheck["id"]): ReadinessCheck => ({ id, severity: "unknown", title: `${id} unknown`, fix: { kind: "edit" } });
const block = (id: ReadinessCheck["id"], detail?: string): ReadinessCheck => ({ id, severity: "blocking", title: `${id} blocks`, detail, fix: { kind: "discussion" } });

describe("readinessVerdict — before the gear leaves", () => {
  test("a blocker holds prep, leads in words, and the rest list worst first", () => {
    const v = readinessVerdict(
      [pass("gear"), warn("crew"), block("discussions", "Prep and dispatch are held."), unknown("conflicts"), block("gear")],
      "CONFIRMED",
    );
    expect(v.headline).toBe("Prep is held");
    expect(v.tone).toBe("held");
    expect(v.lead).toBe("discussions blocks. Prep and dispatch are held.");
    expect(v.leadCheck?.id).toBe("discussions");
    // The lead's blocker is not repeated; another blocker outranks unknown, which outranks a warning.
    expect(v.rows.map((r) => `${r.id}:${r.severity}`)).toEqual(["gear:blocking", "conflicts:unknown", "crew:warning"]);
    expect(v.clear.map((c) => c.id)).toEqual(["gear"]);
  });

  test("warnings or unknowns only: not ready yet, counted in the lead", () => {
    const v = readinessVerdict([pass("gear"), warn("crew"), unknown("conflicts")], "QUOTED");
    expect(v.headline).toBe("Not ready for prep yet");
    expect(v.lead).toBe("2 things to sort before the gear leaves.");
    expect(v.rows.map((r) => r.id)).toEqual(["conflicts", "crew"]);
  });

  test("an unknown is never clear", () => {
    const v = readinessVerdict([unknown("gear")], "ENQUIRY");
    expect(v.tone).toBe("todo");
    expect(v.clear).toEqual([]);
  });

  test("a blocking count still loading, with nothing else failing, does NOT read Ready", () => {
    const checks = buildReadinessChecks({
      hasWindow: true,
      gear: { hard: [], pencilled: [] },
      crew: { unconfirmedCount: 0, activeCount: 0, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 },
      pricing: { unpriced: [], unpricedCount: 0 },
      conflicts: [],
      packing: { totalCount: 0, notPlannedCount: 0 },
      incidents: { openCount: 0, truncated: false },
      blockingCount: null,
      status: "CONFIRMED",
    });
    const v = readinessVerdict(checks, "CONFIRMED");
    expect(v.headline).not.toBe("Ready for prep");
    expect(v.rows.map((r) => `${r.id}:${r.severity}`)).toEqual(["discussions:unknown"]);
  });

  test("all passing reads Ready for prep", () => {
    const v = readinessVerdict([pass("gear"), pass("conflicts")], "PREPPING");
    expect(v).toMatchObject({ headline: "Ready for prep", tone: "clear", rows: [] });
    expect(v.clear).toHaveLength(2);
  });
});

describe("readinessVerdict — from Out onward", () => {
  test.each(["CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED", "CANCELLED"])("%s is a state sentence", (status) => {
    expect(isPastPrep(status)).toBe(true);
    const v = readinessVerdict([warn("crew"), pass("gear")], status);
    expect(v.mode).toBe("state");
    expect(v.lead).toBeNull();
    expect(v.rows).toEqual([]);
  });

  test("Out says Out, from the vocabulary", () => {
    expect(readinessVerdict([], "CHECKED_OUT").headline).toMatch(/^Out — /);
  });

  test("failing incidents and blocking discussions still list under the sentence; the prep checks do not", () => {
    const v = readinessVerdict([warn("incidents"), block("discussions"), block("gear"), warn("packing")], "RETURNED");
    expect(v.rows.map((r) => r.id)).toEqual(["discussions", "incidents"]);
  });

  test.each(["ENQUIRY", "QUOTING", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "PREPPING"])("%s is still a checklist", (status) => {
    expect(isPastPrep(status)).toBe(false);
  });
});

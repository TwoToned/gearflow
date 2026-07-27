// @vitest-environment node
//
// services-panel.tsx's `pickConflictBadge` (WS8 #947) — the ONE per-member
// badge precedence used by the picker row badge, the CrewRateTable sub-line,
// the section-level "N of M selected have clashes" summary, AND the
// "Send offers"/"Confirm all" pre-flight count. This test locks in that
// precedence and a pre-flight COUNT PARITY fixture: the same conflict data,
// counted the way the section summary / bulk pre-flight line count it
// (excluding a "preferred" positive hint from the clash count), matches what
// the query-level severity model (convex/lib/crewConflicts.ts) would classify.
import { describe, test, expect } from "vitest";
import { pickConflictBadge, type CrewConflictSummary } from "@/components/projects/services-panel";

function summary(over: Partial<CrewConflictSummary> = {}): CrewConflictSummary {
  return { conflicts: [], isUnavailable: false, availability: "available", hasPreferredBlock: false, ...over };
}

describe("pickConflictBadge", () => {
  test("undefined member (not yet loaded) → no badge", () => {
    expect(pickConflictBadge(undefined)).toBeNull();
  });

  test("no conflicts at all → no badge", () => {
    expect(pickConflictBadge(summary())).toBeNull();
  });

  test("isUnavailable wins outright → hard 'Unavailable'", () => {
    expect(pickConflictBadge(summary({ isUnavailable: true, conflicts: [{ severity: "soft", label: "Pencilled: P1 - Gig" }] }))).toEqual({
      severity: "hard",
      label: "Unavailable",
    });
  });

  test("a hard conflict (no isUnavailable) → hard, its own label", () => {
    expect(pickConflictBadge(summary({ conflicts: [{ severity: "hard", label: "Booked: P1 - Gig" }] }))).toEqual({
      severity: "hard",
      label: "Booked: P1 - Gig",
    });
  });

  test("availability 'tentative' (no hard conflict) → soft 'Tentative'", () => {
    expect(pickConflictBadge(summary({ availability: "tentative" }))).toEqual({ severity: "soft", label: "Tentative" });
  });

  test("a soft conflict (no tentative, no hard) → soft, its own label", () => {
    expect(pickConflictBadge(summary({ conflicts: [{ severity: "soft", label: "Pencilled: P2 - Other" }] }))).toEqual({
      severity: "soft",
      label: "Pencilled: P2 - Other",
    });
  });

  test("hasPreferredBlock (no other signal) → positive 'Preferred' hint", () => {
    expect(pickConflictBadge(summary({ hasPreferredBlock: true }))).toEqual({ severity: "preferred", label: "Preferred" });
  });

  test("hard conflict beats a simultaneous preferred hint", () => {
    expect(
      pickConflictBadge(summary({ hasPreferredBlock: true, conflicts: [{ severity: "hard", label: "Booked: P1 - Gig" }] })),
    ).toEqual({ severity: "hard", label: "Booked: P1 - Gig" });
  });
});

describe("pre-flight clash count parity (section summary / bulk 'Send offers' confirm dialog)", () => {
  // Mirrors services-panel.tsx's `selectedConflictCount`: count members whose
  // badge is non-null AND not the "preferred" positive hint.
  function countClashes(members: (CrewConflictSummary | undefined)[]): number {
    return members.filter((m) => {
      const badge = pickConflictBadge(m);
      return badge != null && badge.severity !== "preferred";
    }).length;
  }

  test("a mix of hard/soft/preferred/none — only hard+soft count as clashes", () => {
    const members: CrewConflictSummary[] = [
      summary({ isUnavailable: true }), // hard — counts
      summary({ conflicts: [{ severity: "soft", label: "Pencilled: P1 - Gig" }] }), // soft — counts
      summary({ hasPreferredBlock: true }), // preferred — does NOT count
      summary(), // none — does NOT count
    ];
    expect(countClashes(members)).toBe(2);
  });

  test("all-clear roster → zero clashes, matching an empty conflicts[] from the query", () => {
    const members: CrewConflictSummary[] = [summary(), summary(), summary()];
    expect(countClashes(members)).toBe(0);
  });

  test("an unloaded member (undefined) never counts as a clash", () => {
    expect(countClashes([undefined, summary({ isUnavailable: true })])).toBe(1);
  });
});

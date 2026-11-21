// @vitest-environment node
import { describe, expect, test } from "vitest";
import { deriveEntryMoney, entryRate, sumTotals, type MoneyAssignment, type MoneyEntry, type MoneyLookups, type MoneyMember, type MoneyRole } from "./timeEntryMoney";

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 10, 16); // Mon 16 Nov 2026, UTC midnight

function lookups(a: Record<string, MoneyAssignment>, m: Record<string, MoneyMember>, r: Record<string, MoneyRole>): MoneyLookups {
  return { assignment: (id) => a[id], member: (id) => m[id], role: (id) => r[id] };
}
const e = (id: string, over: Partial<MoneyEntry> = {}): MoneyEntry => ({ id, crewMemberId: "c1", date: D0, startTime: "09:00", totalHours: 8, ...over });

describe("timeEntryMoney (D49 — derived pay, never stored)", () => {
  test("HOURLY: rate × hours", () => {
    const l = lookups({ a1: { rateOverride: 55, rateType: "HOURLY" } }, { c1: {} }, {});
    const m = deriveEntryMoney([e("t1", { assignmentId: "a1", totalHours: 7.5 })], l);
    expect(m.get("t1")).toEqual({ rate: 55, rateType: "HOURLY", total: 412.5, included: false });
  });

  test("HOURLY with no hours yet: rate shown, total blank", () => {
    const l = lookups({ a1: { rateOverride: 55, rateType: "HOURLY" } }, { c1: {} }, {});
    expect(deriveEntryMoney([e("t1", { assignmentId: "a1", totalHours: null })], l).get("t1")?.total).toBeNull();
  });

  test("DAILY counts ONCE per person per day, whatever the number of entries (owner, Q-S2)", () => {
    const l = lookups({ a1: { rateOverride: 600, rateType: "DAILY" }, a2: { rateOverride: 600, rateType: "DAILY" } }, { c1: {}, c2: {} }, {});
    const m = deriveEntryMoney(
      [
        e("late", { assignmentId: "a1", startTime: "14:00" }),
        e("early", { assignmentId: "a2", startTime: "07:00" }), // a second job the same day
        e("nextDay", { assignmentId: "a1", date: D0 + DAY }),
        e("other", { assignmentId: "a1", crewMemberId: "c2" }), // another person, same day
      ],
      l,
    );
    expect(m.get("early")).toMatchObject({ total: 600, included: false });
    expect(m.get("late")).toMatchObject({ rate: 600, total: null, included: true });
    expect(m.get("nextDay")).toMatchObject({ total: 600, included: false });
    expect(m.get("other")).toMatchObject({ total: 600, included: false });
    expect(sumTotals(m.values())).toBe(1800);
  });

  test("the carrier is stable whatever order the entries arrive in", () => {
    const l = lookups({ a1: { rateOverride: 600, rateType: "DAILY" } }, { c1: {} }, {});
    const one = deriveEntryMoney([e("x", { assignmentId: "a1", startTime: "08:00" }), e("y", { assignmentId: "a1", startTime: "12:00" })], l);
    const two = deriveEntryMoney([e("y", { assignmentId: "a1", startTime: "12:00" }), e("x", { assignmentId: "a1", startTime: "08:00" })], l);
    expect(one.get("x")?.included).toBe(false);
    expect(two.get("x")?.included).toBe(false);
    expect(two.get("y")?.included).toBe(true);
  });

  test("FLAT counts once per person per assignment", () => {
    const l = lookups({ a1: { rateOverride: 900, rateType: "FLAT" } }, { c1: {} }, {});
    const m = deriveEntryMoney([e("d1", { assignmentId: "a1" }), e("d2", { assignmentId: "a1", date: D0 + DAY })], l);
    expect(m.get("d1")?.total).toBe(900);
    expect(m.get("d2")).toMatchObject({ total: null, included: true });
  });

  test("cascade: member day rate beats the role default; a general entry uses the member's own role", () => {
    const l = lookups({ a1: { crewRoleId: "r1" } }, { c1: { defaultDayRate: 450 }, c2: { crewRoleId: "r1" } }, { r1: { defaultRate: 40, rateType: "HOURLY" } });
    expect(entryRate(e("t1", { assignmentId: "a1" }), l)).toEqual({ rate: 450, rateType: "DAILY" });
    expect(entryRate(e("t2", { crewMemberId: "c2" }), l)).toEqual({ rate: 40, rateType: "HOURLY" });
  });

  test("nothing resolves → blank rate and total (blank is not $0)", () => {
    const l = lookups({}, { c1: {} }, {});
    expect(deriveEntryMoney([e("t1")], l).get("t1")).toEqual({ rate: null, rateType: null, total: null, included: false });
    expect(sumTotals([])).toBe(0);
  });
});

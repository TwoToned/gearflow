import { describe, it, expect } from "vitest";
import {
  parseFloorUrl, serializeFloorUrl, inScope, matchesQuery, floorFlags, progressOf, dispatchText, windowText,
  byStage, nextOutText, overdueDays, isCloseable, returnsRedirectHref, matchesFilters,
} from "@/lib/warehouse-floor";
import { floorJob, DAY, NOW, TODAY } from "./floor-fixtures";

const params = (qs: string) => new URLSearchParams(qs);
const DEFAULTS = { mode: "floor", scope: "week", stage: null, q: "", outcome: null, job: null, show: 25, client: [], flags: [], packer: [] };

describe("floor URL (D11)", () => {
  it("defaults are omitted and round-trip", () => {
    const s = parseFloorUrl(params(""));
    expect(s).toEqual(DEFAULTS);
    expect(serializeFloorUrl(s)).toBe("");
    const t = parseFloorUrl(params("mode=returning&scope=all&stage=out&q=2341&outcome=damaged&job=p1&show=50"));
    expect(t).toMatchObject({ outcome: "damaged", job: "p1", show: 50 });
    expect(parseFloorUrl(params(serializeFloorUrl(t).slice(1)))).toEqual(t);
  });
  it("invalid values fall back to the default instead of throwing", () => {
    expect(parseFloorUrl(params("mode=x&scope=forever&stage=lost&outcome=gone&job=a%20b&show=-4"))).toEqual(DEFAULTS);
  });
  it("Returning-only keys never leak onto the board's URL", () => {
    const s = parseFloorUrl(params("outcome=late&job=p1&show=50"));
    expect(serializeFloorUrl(s)).toBe("");
  });
  it("filter words are comma lists that round-trip; bad entries drop the whole word", () => {
    const s = parseFloorUrl(params("client=c1,c2&flags=overdue,pay&packer=u2,none"));
    expect(s).toMatchObject({ client: ["c1", "c2"], flags: ["overdue", "pay"], packer: ["u2", "none"] });
    expect(serializeFloorUrl(s)).toBe("?client=c1%2Cc2&flags=overdue%2Cpay&packer=u2%2Cnone");
    expect(parseFloorUrl(params("flags=overdue,sideways")).flags).toEqual([]);
  });
  it("/warehouse/returns redirects to Returning mode, keeping its query", () => {
    expect(returnsRedirectHref({})).toBe("/warehouse?mode=returning");
    expect(returnsRedirectHref({ mode: "floor", outcome: "late", job: ["p1", "p2"] })).toBe("/warehouse?mode=returning&outcome=late&job=p1&job=p2");
  });
});

describe("scope (§9c.2)", () => {
  const ctx = { now: NOW, userId: "u1" };
  it("Today = leaves today or tomorrow; This week = within 7 days; a late leaver stays", () => {
    const tomorrow = floorJob({ id: "a", projectStartDate: TODAY + DAY });
    const in5 = floorJob({ id: "b", projectStartDate: TODAY + 5 * DAY });
    const late = floorJob({ id: "c", projectStartDate: TODAY - 2 * DAY });
    expect([tomorrow, in5, late].map((j) => inScope(j, "today", ctx))).toEqual([true, false, true]);
    expect([tomorrow, in5, late].map((j) => inScope(j, "week", ctx))).toEqual([true, true, true]);
  });
  it("the truck's day wins over the job start", () => {
    const j = floorJob({ id: "a", projectStartDate: TODAY + DAY, outbound: { kind: "truck", date: TODAY + 6 * DAY, time: "06:30", vehicle: null } });
    expect(inScope(j, "today", ctx)).toBe(false);
    expect(inScope(j, "week", ctx)).toBe(true);
  });
  it("Out counts by due-back; Returning is always in; Mine is the PM; All is everything", () => {
    const outDue = floorJob({ id: "a", stage: "out", projectEndDate: TODAY + DAY });
    const outLater = floorJob({ id: "b", stage: "out", projectEndDate: TODAY + 20 * DAY });
    const back = floorJob({ id: "c", stage: "returning", projectEndDate: TODAY + 20 * DAY });
    expect([outDue, outLater, back].map((j) => inScope(j, "today", ctx))).toEqual([true, false, true]);
    expect(inScope(floorJob({ id: "d", projectManagerId: "u1" }), "mine", ctx)).toBe(true);
    expect(inScope(floorJob({ id: "e", projectManagerId: "u2" }), "mine", ctx)).toBe(false);
    // Mine = PM OR packer.
    expect(inScope(floorJob({ id: "g", projectManagerId: "u2", packerUserId: "u1" }), "mine", ctx)).toBe(true);
  });
  it("filter words: OR within a word, AND across words; `none` is no packer", () => {
    const none = { client: [], flags: [], packer: [] };
    const a = floorJob({ id: "a", clientId: "c1", packerUserId: "u2" });
    const b = floorJob({ id: "b", clientId: "c2", packerUserId: null, status: "AWAITING_PAYMENT" });
    expect([a, b].map((j) => matchesFilters(j, none, NOW))).toEqual([true, true]);
    expect([a, b].map((j) => matchesFilters(j, { ...none, client: ["c1", "c2"] }, NOW))).toEqual([true, true]);
    expect([a, b].map((j) => matchesFilters(j, { ...none, packer: ["none"] }, NOW))).toEqual([false, true]);
    expect([a, b].map((j) => matchesFilters(j, { ...none, flags: ["pay"], client: ["c1"] }, NOW))).toEqual([false, false]);
    expect(matchesFilters(b, { ...none, flags: ["pay", "overdue"] }, NOW)).toBe(true);
    expect(inScope(floorJob({ id: "f", projectStartDate: TODAY + 90 * DAY }), "all", ctx)).toBe(true);
  });
  it("the dock filters by number, name and client", () => {
    const j = floorJob({ id: "2341", name: "Gala", client: { name: "Live Nation" } });
    expect(["234", "gala", "nation", ""].map((q) => matchesQuery(j, q))).toEqual([true, true, true, true]);
    expect(matchesQuery(j, "xyz")).toBe(false);
  });
});

describe("card text", () => {
  it("flags: overdue (gear still out), awaiting payment, damaged, missing", () => {
    const j = floorJob({
      id: "a", status: "AWAITING_PAYMENT", stage: "returning", projectEndDate: TODAY - 3 * DAY,
      counts: { lines: 1, linesToPick: 0, items: 4, packed: 0, out: 1, back: 3, damaged: 1, missing: 2 },
    });
    expect(floorFlags(j, NOW).map((f) => f.label)).toEqual(["3d overdue", "awaiting payment", "1 damaged", "2 missing"]);
    expect(overdueDays({ ...j, counts: { ...j.counts, out: 0 } }, NOW)).toBe(0);
  });
  it("progress reads by column", () => {
    expect(progressOf(floorJob({ id: "a", counts: { lines: 18, linesToPick: 4, items: 40, packed: 30, out: 0, back: 0, damaged: 0, missing: 0 } })))
      .toEqual({ text: "18 lines · 4 to pick", ratio: 0.75 });
    expect(progressOf(floorJob({ id: "b", stage: "out", counts: { lines: 9, linesToPick: 0, items: 78, packed: 0, out: 78, back: 0, damaged: 0, missing: 0 } })).text)
      .toBe("78 items out");
    expect(progressOf(floorJob({ id: "c", stage: "returning", counts: { lines: 9, linesToPick: 0, items: 88, packed: 0, out: 42, back: 46, damaged: 0, missing: 0 } })).text)
      .toBe("46 of 88 items back");
  });
  it("dispatch: truck, client pick-up, or the job start", () => {
    const tue = new Date(2026, 10, 17).getTime();
    expect(dispatchText(floorJob({ id: "a", outbound: { kind: "truck", date: tue, time: "06:30", vehicle: "Van 2" } }))).toBe("Truck Tue 06:30 · Van 2");
    expect(dispatchText(floorJob({ id: "b", outbound: { kind: "client", date: tue, time: "10:00", vehicle: null } }))).toBe("Client collects Tue 10:00");
    // The locale role's own shape (en-AU prints a comma after the weekday).
    expect(dispatchText(floorJob({ id: "c", projectStartDate: tue }))).toBe("Out Tue, 17 Nov");
  });
  it("window text is client · range", () => {
    expect(windowText(floorJob({ id: "a", projectStartDate: new Date(2026, 10, 12).getTime(), projectEndDate: new Date(2026, 10, 14).getTime() }))).toBe("Acme · 12 – 14 Nov");
  });
});

describe("board", () => {
  it("columns sort by when the gear leaves, out by due-back; next out skips the past", () => {
    const a = floorJob({ id: "a", projectStartDate: TODAY + 3 * DAY });
    const b = floorJob({ id: "b", projectStartDate: TODAY + DAY });
    const past = floorJob({ id: "p", projectStartDate: TODAY - DAY });
    const o1 = floorJob({ id: "o1", stage: "out", projectEndDate: TODAY + 5 * DAY });
    const o2 = floorJob({ id: "o2", stage: "out", projectEndDate: TODAY + 2 * DAY });
    const cols = byStage([a, b, past, o1, o2]);
    expect(cols.topick.map((j) => j.id)).toEqual(["p", "b", "a"]);
    expect(cols.out.map((j) => j.id)).toEqual(["o2", "o1"]);
    expect(nextOutText([a, b, past], NOW)).toBe("next out #b Wed");
  });
  it("only a returned job is closeable", () => {
    expect(isCloseable(floorJob({ id: "a", status: "RETURNED" }))).toBe(true);
    expect(isCloseable(floorJob({ id: "b", status: "CHECKED_OUT" }))).toBe(false);
  });
});

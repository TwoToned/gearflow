// @vitest-environment node
//
// convex/lib/gearGrid.ts: the Schedule's Gear grid is read off the Overbookings
// board's own sweep. A cell is "short on D" exactly when the board has a hard
// conflict overlapping D (and "at risk" exactly for a pencilled one), over real
// datetime windows: stock 1, A ends 10:00, B starts 14:00 is NOT short. Pure: no
// db, no clock, a seeded generator for the parity property.
import { describe, expect, test } from "vitest";

import { computeGearShortageBoard, type BoardLineItem, type BoardProject } from "./lib/overbookingBoard";
import { deriveGearGrid } from "./lib/gearGrid";
import type { ScheduleFlagInput } from "./lib/scheduleBoard";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 10, 9); // Mon 9 Nov 2026 00:00 UTC
const RANGE = { start: BASE, end: BASE + 5 * DAY - 1 };
const DAYS = [0, 1, 2, 3, 4].map((i) => BASE + i * DAY);

type Window = [number, number];
interface Job {
  id: string;
  status: string;
  win: Window;
  lines: { qty: number; off?: number; optional?: boolean; subHire?: boolean; type?: string; status?: string }[];
}

function project(j: Job): BoardProject & { projectManagerId?: string | null } {
  return { id: j.id, status: j.status, name: `Job ${j.id}`, projectNumber: `#${j.id}`, rentalStartDate: j.win[0], rentalEndDate: j.win[1], isTemplate: false };
}

function lines(jobs: Job[]): BoardLineItem[] {
  let n = 0;
  return jobs.flatMap((j) =>
    j.lines.map((l) => ({
      id: `L${n}`, projectId: j.id, modelId: "m1", quantity: l.qty, offInventoryQuantity: l.off, status: l.status ?? "CONFIRMED",
      isOptional: l.optional, subHireId: l.subHire ? "sh" : null, type: l.type ?? "EQUIPMENT", createdAt: ++n,
    })),
  );
}

interface Stock {
  serialised?: { status: string }[];
  bulk?: number;
}

function input(jobs: Job[], stock: Stock, over: Partial<ScheduleFlagInput> = {}) {
  return {
    range: RANGE,
    projects: jobs.map(project),
    lines: lines(jobs),
    unreadProjectIds: new Set<string>(),
    models: [{ id: "m1", name: "EM4", assetType: stock.bulk != null ? "BULK" : "SERIALIZED" }],
    assets: (stock.serialised ?? []).map((a) => ({ modelId: "m1", status: a.status, isActive: true })),
    bulkAssets: stock.bulk != null ? [{ id: "b1", modelId: "m1", assetTag: "B-1", totalQuantity: stock.bulk, isActive: true }] : [],
    unknownModelIds: new Set<string>(),
    claimsComplete: true,
    ...over,
  };
}

const units = (n: number) => Array.from({ length: n }, () => ({ status: "AVAILABLE" }));
const row = (jobs: Job[], stock: Stock, over: Partial<ScheduleFlagInput> = {}) => deriveGearGrid(input(jobs, stock, over), DAYS)[0];
const D2 = BASE + 2 * DAY;

describe("the grid reads the board's own sweep over real datetimes", () => {
  test("stock 1, A ends 10:00 and B starts 14:00 the same day: nobody is short, held peaks at 1", () => {
    const r = row(
      [
        { id: "A", status: "CONFIRMED", win: [D2 - DAY, D2 + 10 * HOUR], lines: [{ qty: 1 }] },
        { id: "B", status: "CONFIRMED", win: [D2 + 14 * HOUR, D2 + DAY], lines: [{ qty: 1 }] },
      ],
      { serialised: units(1) },
    );
    expect(r.cells[2]).toMatchObject({ unknown: false, held: 1, free: 0, short: 0 });
    expect(r.shortSegments).toEqual([]);
  });

  test("a genuine same-day overlap (A ends 15:00, B starts 14:00) is short 1 on that day only", () => {
    const r = row(
      [
        { id: "A", status: "CONFIRMED", win: [D2 - DAY, D2 + 15 * HOUR], lines: [{ qty: 1 }] },
        { id: "B", status: "CONFIRMED", win: [D2 + 14 * HOUR, D2 + DAY + 10 * HOUR], lines: [{ qty: 1 }] },
      ],
      { serialised: units(1) },
    );
    expect(r.cells.map((c) => c.short)).toEqual([0, 0, 1, 0, 0]);
    expect(r.cells[2]).toMatchObject({ held: 2, free: -1 });
    // the sheet's Sub-hire list: only the job that does not fit (B arrived second), with its own shortfall
    expect(r.shortSegments).toHaveLength(1);
    expect(r.shortSegments[0].over).toEqual([{ projectId: "B", qty: 1 }]);
  });

  test("several short jobs each carry their own shortfall; the one that fits is not listed", () => {
    const r = row(
      [
        { id: "A", status: "CONFIRMED", win: [D2, D2 + DAY], lines: [{ qty: 2 }] },
        { id: "B", status: "CONFIRMED", win: [D2, D2 + DAY], lines: [{ qty: 1 }] },
        { id: "C", status: "CONFIRMED", win: [D2, D2 + DAY], lines: [{ qty: 3 }] },
      ],
      { serialised: units(2) },
    );
    const over = Object.fromEntries(r.shortSegments.flatMap((s) => s.over.map((o) => [o.projectId, o.qty])));
    expect(over).toEqual({ B: 1, C: 3 });
    expect(r.cells[2]).toMatchObject({ held: 6, short: 4 });
  });

  test("atRisk floors at zero when held already exceeds stock: stock 1, held 2, pencilled 1 is at risk 1, short 1", () => {
    const r = row(
      [
        { id: "A", status: "CONFIRMED", win: [D2, D2], lines: [{ qty: 1 }] },
        { id: "B", status: "CONFIRMED", win: [D2, D2], lines: [{ qty: 1 }] },
        { id: "P", status: "QUOTED", win: [D2, D2], lines: [{ qty: 1 }] },
      ],
      { serialised: units(1) },
    );
    expect(r.cells[2]).toMatchObject({ held: 2, short: 1, pencilled: 1, atRisk: 1 });
  });

  test("a model whose claims are only outside the days shown gets no row (the claim range is wider than the view)", () => {
    const wide = { ...RANGE, end: RANGE.end + 20 * DAY };
    const jobs: Job[] = [{ id: "Y", status: "CONFIRMED", win: [BASE + 12 * DAY, BASE + 13 * DAY], lines: [{ qty: 1 }] }];
    expect(deriveGearGrid(input(jobs, { serialised: units(1) }, { range: wide }), DAYS)).toEqual([]);
  });
});

describe("a cell that was not read in full is unknown, never a number", () => {
  const jobs: Job[] = [{ id: "A", status: "CONFIRMED", win: [D2, D2], lines: [{ qty: 1 }] }];

  test("the alive scan was cut: every cell of every row is unknown", () => {
    const r = row(jobs, { serialised: units(2) }, { claimsComplete: false });
    expect(r.unknown).toBe(true);
    expect(r.cells.every((c) => c.unknown)).toBe(true);
  });

  test("a model whose stock was beyond the budget is unknown, and a model that was never loaded says so neutrally", () => {
    const capped = row(jobs, { serialised: units(2) }, { unknownModelIds: new Set(["m1"]) });
    expect(capped.unknown).toBe(true);
    expect(capped.cells.every((c) => c.unknown)).toBe(true);
    const notLoaded = row(jobs, { serialised: units(2) }, { models: [] });
    expect(notLoaded).toMatchObject({ name: "Model not loaded", unknown: true });
    expect(notLoaded.cells.every((c) => c.unknown)).toBe(true);
  });

  test("an unread job blinds every model on the days it covers, and only those", () => {
    const withUnread: Job[] = [...jobs, { id: "U", status: "CONFIRMED", win: [BASE + 3 * DAY, BASE + 4 * DAY], lines: [] }];
    const r = row(withUnread, { serialised: units(2) }, { unreadProjectIds: new Set(["U"]) });
    expect(r.cells.map((c) => c.unknown)).toEqual([false, false, false, true, true]);
  });
});

// ─── parity with computeGearShortageBoard, over random datetime windows ─────────

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = ["CONFIRMED", "PREPPING", "AWAITING_PAYMENT", "QUOTED", "ENQUIRY", "QUOTING"];

function randomTrial(rand: () => number): { jobs: Job[]; stock: Stock } {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const jobs: Job[] = Array.from({ length: int(2, 6) }, (_, i) => {
    const start = BASE + int(0, 4 * 24) * HOUR;
    return {
      id: `J${i}`,
      status: pick(STATUSES),
      win: [start, start + int(1, 60) * HOUR] as Window,
      lines: Array.from({ length: int(1, 2) }, () => {
        const qty = int(1, 3);
        return {
          qty,
          off: rand() < 0.2 && qty > 1 ? 1 : undefined,
          optional: rand() < 0.2,
          subHire: rand() < 0.15,
          type: rand() < 0.1 ? "SALE" : "EQUIPMENT",
          status: rand() < 0.1 ? "CANCELLED" : "CONFIRMED",
        };
      }),
    };
  });
  const stock: Stock = rand() < 0.3 ? { bulk: int(1, 5) } : { serialised: Array.from({ length: int(1, 4) }, () => ({ status: rand() < 0.2 ? "IN_MAINTENANCE" : "AVAILABLE" })) };
  return { jobs, stock };
}

describe("parity with computeGearShortageBoard over random datetime windows (seeded)", () => {
  test("short and at-risk on day D are the board's peak hard / pencilled overage overlapping D, for serialised, bulk, sub-hire, SALE, cancelled, optional and off-inventory lines", () => {
    const rand = prng(20261126);
    let shortDays = 0;
    let riskDays = 0;
    for (let trial = 0; trial < 300; trial++) {
      const { jobs, stock } = randomTrial(rand);
      const inp = input(jobs, stock);
      const board = computeGearShortageBoard(RANGE, inp.projects, inp.lines, inp.models, inp.assets, inp.bulkAssets);
      const grid = deriveGearGrid(inp, DAYS).find((r) => r.modelId === "m1");
      for (const [i, d] of DAYS.entries()) {
        const to = d + DAY - 1;
        const peak = (rows: typeof board.hard) => Math.max(0, ...rows.filter((r) => r.modelId === "m1" && r.spanStart <= to && r.spanEnd >= d).map((r) => r.qty));
        const cell = grid?.cells[i];
        const msg = `trial ${trial} day ${i}`;
        expect(cell?.short ?? 0, msg).toBe(peak(board.hard));
        expect(cell?.atRisk ?? 0, msg).toBe(peak(board.pencilled));
        if (peak(board.hard) > 0) shortDays++;
        if (peak(board.pencilled) > 0) riskDays++;
      }
    }
    // the generator really does exercise both layers
    expect(shortDays).toBeGreaterThan(50);
    expect(riskDays).toBeGreaterThan(50);
  });
});

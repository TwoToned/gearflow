// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  allocateProject,
  largestRemainder,
  rollupByModel,
  isRoiCounted,
  suggestKitAllocation,
  allocationCoversKit,
  deriveRateFactor,
  type AllocLine,
  type AllocModel,
  type AllocGroup,
} from "./lib/allocation";

/**
 * The money gate for revenue allocation (docs/revenue-allocation-design.md).
 *
 * The invariant every one of these tests is really checking: the parts sum to the
 * pool, exactly, in cents. A leak here doesn't throw — it silently skews every ROI
 * number in the app, forever, in a direction nobody can spot by eye.
 */

// ── fixtures ─────────────────────────────────────────────────────────────────

const M = (id: string, o: Partial<AllocModel> = {}): AllocModel => ({ id, ...o });

const L = (id: string, o: Partial<AllocLine> = {}): AllocLine => ({
  id,
  quantity: 1,
  duration: 1,
  sortOrder: 0,
  status: "CONFIRMED",
  ...o,
});

const models = (...ms: AllocModel[]) => new Map(ms.map((m) => [m.id, m]));
const kitAlloc = (kitId: string, pcts: Record<string, number>) =>
  new Map([[kitId, new Map(Object.entries(pcts))]]);
const noKits = new Map<string, Map<string, number>>();

const run = (
  lines: AllocLine[],
  opts: {
    groups?: AllocGroup[];
    models?: Map<string, AllocModel>;
    kitAllocations?: Map<string, Map<string, number>>;
    rentalPeriod?: string;
    rateFactor?: number;
  } = {},
) =>
  allocateProject({
    lines,
    groups: opts.groups ?? [],
    models: opts.models ?? new Map(),
    kitAllocations: opts.kitAllocations ?? noKits,
    rentalPeriod: opts.rentalPeriod,
    rateFactor: opts.rateFactor,
  });

const rev = (r: Map<string, { allocatedRevenue: number | null }>, id: string) =>
  r.get(id)!.allocatedRevenue;
const basis = (r: Map<string, { allocationBasis: string }>, id: string) =>
  r.get(id)!.allocationBasis;

/**
 * Sum the leaves and return dollars. Adds in CENTS deliberately: summing dollars
 * as floats reintroduces exactly the drift the engine exists to avoid, and would
 * make this helper report 899.9999999999999 for a correct $900 split.
 */
const sumOf = (
  r: Map<string, { allocatedRevenue: number | null; allocationBasis: string }>,
  ids: string[],
) =>
  ids.reduce((s, id) => s + Math.round((r.get(id)!.allocatedRevenue ?? 0) * 100), 0) / 100;

// ── largestRemainder ─────────────────────────────────────────────────────────

describe("largestRemainder", () => {
  test("distributes every cent, never more, never less", () => {
    const shares = largestRemainder(10_000, [1, 1, 1], [0, 1, 2]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(shares).toEqual([3334, 3333, 3333]);
  });

  test("hands leftover cents to the largest remainders, not the first rows", () => {
    // 100c across weights 1,1,2 → 25/25/50 exactly; add a cent of slack.
    const shares = largestRemainder(101, [1, 1, 2], [0, 1, 2]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(101);
  });

  test("zero total weight falls back to an equal split", () => {
    expect(largestRemainder(900, [0, 0, 0], [0, 1, 2])).toEqual([300, 300, 300]);
  });

  test("is deterministic under tied remainders (breaks on order)", () => {
    const a = largestRemainder(100, [1, 1, 1], [0, 1, 2]);
    const b = largestRemainder(100, [1, 1, 1], [0, 1, 2]);
    expect(a).toEqual(b);
    expect(a.reduce((x, y) => x + y, 0)).toBe(100);
  });

  test("a zero or negative pool allocates nothing", () => {
    expect(largestRemainder(0, [3, 1], [0, 1])).toEqual([0, 0]);
    expect(largestRemainder(-500, [3, 1], [0, 1])).toEqual([0, 0]);
  });
});

// ── standalone lines ─────────────────────────────────────────────────────────

describe("standalone lines", () => {
  test("a plain gear line is allocated its own lineTotal, DIRECT", () => {
    const r = run([L("a", { modelId: "m1", lineTotal: 250 })]);
    expect(rev(r, "a")).toBe(250);
    expect(basis(r, "a")).toBe("DIRECT");
  });

  test("a $0 line is NO_REVENUE, not DIRECT", () => {
    const r = run([L("a", { modelId: "m1", lineTotal: 0 })]);
    expect(rev(r, "a")).toBe(0);
    expect(basis(r, "a")).toBe("NO_REVENUE");
  });

  test("custom and container lines carry null — nothing to attribute", () => {
    const r = run([
      L("custom", { lineTotal: 500, isCustomItem: true }),
      L("case", { lineTotal: 20, isContainerLineItem: true }),
    ]);
    expect(rev(r, "custom")).toBeNull();
    expect(basis(r, "custom")).toBe("EXCLUDED_NON_GEAR");
    expect(rev(r, "case")).toBeNull();
  });

  test("cancelled and optional lines earn zero and dilute nothing", () => {
    const r = run([
      L("x", { modelId: "m1", lineTotal: 100, status: "CANCELLED" }),
      L("y", { modelId: "m1", lineTotal: 100, isOptional: true }),
    ]);
    expect(rev(r, "x")).toBe(0);
    expect(basis(r, "x")).toBe("NO_REVENUE");
    expect(rev(r, "y")).toBe(0);
  });
});

// ── kits ─────────────────────────────────────────────────────────────────────

describe("kits — Approach A", () => {
  /** The worked example from the design doc: RF Kit 1 at $900. */
  const rfKit = () => [
    L("kit", { kitId: "k1", lineTotal: 900 }),
    L("rx", { parentLineItemId: "kit", modelId: "rx", quantity: 4, sortOrder: 1 }),
    L("bp", { parentLineItemId: "kit", modelId: "bp", quantity: 4, sortOrder: 2 }),
    L("hs", { parentLineItemId: "kit", modelId: "hs", quantity: 4, sortOrder: 3 }),
    L("swb", { parentLineItemId: "kit", modelId: "swb", sortOrder: 4 }),
    L("sw", { parentLineItemId: "kit", modelId: "sw", sortOrder: 5 }),
    L("belt", { parentLineItemId: "kit", modelId: "belt", quantity: 4, sortOrder: 6 }),
    L("case", { parentLineItemId: "kit", modelId: "case", sortOrder: 7 }),
  ];
  const rfPcts = { rx: 35, bp: 25, hs: 15, swb: 10, sw: 8, belt: 5, case: 2 };
  const leaves = ["rx", "bp", "hs", "swb", "sw", "belt", "case"];

  test("saved percentages split the kit price exactly as configured", () => {
    const r = run(rfKit(), { kitAllocations: kitAlloc("k1", rfPcts) });

    expect(rev(r, "rx")).toBe(315);
    expect(rev(r, "bp")).toBe(225);
    expect(rev(r, "hs")).toBe(135);
    expect(rev(r, "swb")).toBe(90);
    expect(rev(r, "sw")).toBe(72);
    expect(rev(r, "belt")).toBe(45);
    expect(rev(r, "case")).toBe(18);
    expect(basis(r, "rx")).toBe("KIT_PERCENT");
    expect(sumOf(r, leaves)).toBe(900);
  });

  test("the kit parent takes no share — it has no model to credit", () => {
    const r = run(rfKit(), { kitAllocations: kitAlloc("k1", rfPcts) });
    expect(rev(r, "kit")).toBeNull();
    expect(basis(r, "kit")).toBe("EXCLUDED_NON_GEAR");
  });

  test("percentages summing to 99.99 still allocate the whole pool", () => {
    const r = run(rfKit(), {
      kitAllocations: kitAlloc("k1", { ...rfPcts, case: 1.99 }),
    });
    expect(sumOf(r, leaves)).toBe(900);
  });

  test("one model spread over several lines splits that model's percent by qty", () => {
    // Same model on two rows (2 units + 6 units) → 25% / 75% of its 40%.
    const r = run(
      [
        L("kit", { kitId: "k1", lineTotal: 1000 }),
        L("a", { parentLineItemId: "kit", modelId: "rx", quantity: 2, sortOrder: 1 }),
        L("b", { parentLineItemId: "kit", modelId: "rx", quantity: 6, sortOrder: 2 }),
        L("c", { parentLineItemId: "kit", modelId: "bp", quantity: 1, sortOrder: 3 }),
      ],
      { kitAllocations: kitAlloc("k1", { rx: 40, bp: 60 }) },
    );
    expect(rev(r, "a")).toBe(100);
    expect(rev(r, "b")).toBe(300);
    expect(rev(r, "c")).toBe(600);
    expect(sumOf(r, ["a", "b", "c"])).toBe(1000);
  });

  test("a STALE allocation is ignored, not trusted, and never blocks the booking", () => {
    // Kit gained a model (`new`) that the saved allocation doesn't cover — the sort
    // of drift a warehouse asset swap causes without touching the allocation form.
    const lines = [
      ...rfKit(),
      L("new", { parentLineItemId: "kit", modelId: "new", sortOrder: 8 }),
    ];
    const r = run(lines, {
      kitAllocations: kitAlloc("k1", rfPcts),
      // Every model rated, so the fall-through lands on rate weighting (not equal).
      models: models(
        M("rx", { dailyRate: 100 }),
        M("bp", { dailyRate: 100 }),
        M("hs", { dailyRate: 100 }),
        M("swb", { dailyRate: 100 }),
        M("sw", { dailyRate: 100 }),
        M("belt", { dailyRate: 100 }),
        M("case", { dailyRate: 100 }),
        M("new", { dailyRate: 100 }),
      ),
    });

    expect(basis(r, "rx")).toBe("WEIGHTED");
    expect(rev(r, "new")).toBeGreaterThan(0);
    expect(sumOf(r, [...leaves, "new"])).toBe(900);
  });

  test("KIT_PRICE children with no allocation are weighted by model day rate", () => {
    const r = run(
      [
        L("kit", { kitId: "k1", lineTotal: 300 }),
        L("a", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("b", { parentLineItemId: "kit", modelId: "belt", sortOrder: 2 }),
      ],
      { models: models(M("rx", { dailyRate: 90 }), M("belt", { dailyRate: 10 })) },
    );
    expect(rev(r, "a")).toBe(270);
    expect(rev(r, "b")).toBe(30);
    expect(basis(r, "a")).toBe("WEIGHTED");
  });

  test("ITEMIZED children are weighted by their own lineTotal", () => {
    const r = run([
      L("kit", { kitId: "k1", lineTotal: 500 }),
      L("a", { parentLineItemId: "kit", modelId: "rx", lineTotal: 300, sortOrder: 1 }),
      L("b", { parentLineItemId: "kit", modelId: "bp", lineTotal: 100, sortOrder: 2 }),
    ]);
    // Kit sold at $500 against $400 of itemised parts — everyone scales up.
    expect(rev(r, "a")).toBe(375);
    expect(rev(r, "b")).toBe(125);
    expect(sumOf(r, ["a", "b"])).toBe(500);
  });

  test("no rate anywhere falls back to replacement cost", () => {
    const r = run(
      [
        L("kit", { kitId: "k1", lineTotal: 100 }),
        L("a", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("b", { parentLineItemId: "kit", modelId: "belt", sortOrder: 2 }),
      ],
      { models: models(M("rx", { replacementCost: 1900 }), M("belt", { replacementCost: 100 })) },
    );
    expect(rev(r, "a")).toBe(95);
    expect(rev(r, "b")).toBe(5);
  });

  test("nothing to weight on at all → equal split, nothing invisible", () => {
    const r = run([
      L("kit", { kitId: "k1", lineTotal: 90 }),
      L("a", { parentLineItemId: "kit", modelId: "x", sortOrder: 1 }),
      L("b", { parentLineItemId: "kit", modelId: "y", sortOrder: 2 }),
      L("c", { parentLineItemId: "kit", modelId: "z", sortOrder: 3 }),
    ]);
    expect(rev(r, "a")).toBe(30);
    expect(rev(r, "c")).toBe(30);
    expect(basis(r, "a")).toBe("EQUAL_SPLIT");
  });

  test("a MIXED-rate kit weights each item on its own signal (rate vs cost-equivalent)", () => {
    // rx has a rate → weighted on its rate. belt has none → weighted on its
    // replacement cost turned into a rate-equivalent. belt still earns, not $0.
    const r = run(
      [
        L("kit", { kitId: "k1", lineTotal: 100 }),
        L("rx", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("belt", { parentLineItemId: "kit", modelId: "belt", sortOrder: 2 }),
      ],
      {
        // rateFactor 0.02: rx weight = 96 (rate), belt weight = 200 × 0.02 = 4.
        rateFactor: 0.02,
        models: models(
          M("rx", { dailyRate: 96 }),
          M("belt", { replacementCost: 200 }), // no rate → cost-equivalent
        ),
      },
    );
    expect(rev(r, "rx")).toBe(96);
    expect(rev(r, "belt")).toBe(4); // not $0
    expect(sumOf(r, ["rx", "belt"])).toBe(100);
  });

  test("an unpriced kit gives its children nothing — can't split nothing", () => {
    const r = run([
      L("kit", { kitId: "k1" }),
      L("a", { parentLineItemId: "kit", modelId: "rx" }),
    ]);
    expect(rev(r, "a")).toBe(0);
    expect(basis(r, "a")).toBe("NO_REVENUE");
  });

  test("a cancelled kit child dilutes nothing; siblings take the whole pool", () => {
    const r = run(
      [
        L("kit", { kitId: "k1", lineTotal: 100 }),
        L("a", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("dead", { parentLineItemId: "kit", modelId: "bp", sortOrder: 2, status: "CANCELLED" }),
      ],
      { models: models(M("rx", { dailyRate: 1 }), M("bp", { dailyRate: 1 })) },
    );
    expect(rev(r, "a")).toBe(100);
    expect(rev(r, "dead")).toBe(0);
  });
});

// ── groups ───────────────────────────────────────────────────────────────────

describe("groups — Approach B", () => {
  /** The worked example from the design doc: $1,250 nominal sold at $400. */
  const vocalRf = () => ({
    groups: [{ id: "g1", price: 400, quantity: 1 }],
    lines: [
      L("rx", { groupId: "g1", modelId: "rx", quantity: 4, lineTotal: 600, sortOrder: 1 }),
      L("sk", { groupId: "g1", modelId: "sk", quantity: 4, lineTotal: 320, sortOrder: 2 }),
      L("hs", { groupId: "g1", modelId: "hs", quantity: 4, lineTotal: 240, sortOrder: 3 }),
      L("swb", { groupId: "g1", modelId: "swb", lineTotal: 45, sortOrder: 4 }),
      L("belt", { groupId: "g1", modelId: "belt", quantity: 4, lineTotal: 40, sortOrder: 5 }),
      L("case", { groupId: "g1", modelId: "case", lineTotal: 5, sortOrder: 6 }),
    ],
  });
  const ids = ["rx", "sk", "hs", "swb", "belt", "case"];

  test("a discounted bundle gives everyone a proportional haircut", () => {
    const { groups, lines } = vocalRf();
    const r = run(lines, { groups });

    expect(rev(r, "rx")).toBe(192);
    expect(rev(r, "sk")).toBeCloseTo(102.4, 2);
    expect(rev(r, "hs")).toBeCloseTo(76.8, 2);
    expect(rev(r, "swb")).toBeCloseTo(14.4, 2);
    expect(rev(r, "belt")).toBeCloseTo(12.8, 2);
    expect(rev(r, "case")).toBeCloseTo(1.6, 2);
    expect(basis(r, "rx")).toBe("WEIGHTED");
  });

  test("the split sums to the bundle price to the cent", () => {
    const { groups, lines } = vocalRf();
    expect(sumOf(run(lines, { groups }), ids)).toBe(400);
  });

  test("the pool is price × quantity, not price", () => {
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", lineTotal: 1, sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", lineTotal: 1, sortOrder: 2 }),
      ],
      { groups: [{ id: "g1", price: 100, quantity: 3 }] },
    );
    expect(sumOf(r, ["a", "b"])).toBe(300);
  });

  test("an awkward price still sums exactly — no leaked cents", () => {
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", lineTotal: 1, sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", lineTotal: 1, sortOrder: 2 }),
        L("c", { groupId: "g1", modelId: "m3", lineTotal: 1, sortOrder: 3 }),
      ],
      { groups: [{ id: "g1", price: 100.01, quantity: 1 }] },
    );
    const total = ["a", "b", "c"].reduce(
      (s, id) => s + Math.round(rev(r, id)! * 100),
      0,
    );
    expect(total).toBe(10_001);
  });

  test("the pool rounds the product, not the price", () => {
    // recalcProjectTotals bills `price × quantity` and rounds the sum. Rounding the
    // price to cents first would allocate $0.02 against a $0.01 charge.
    const r = run([L("a", { groupId: "g1", modelId: "m1", lineTotal: 1 })], {
      groups: [{ id: "g1", price: 0.005, quantity: 2 }],
    });
    expect(rev(r, "a")).toBe(0.01);
  });

  test("an unpriced group allocates nothing to its members", () => {
    const r = run([L("a", { groupId: "g1", modelId: "m1", lineTotal: 50 })], {
      groups: [{ id: "g1", price: null, quantity: 1 }],
    });
    expect(rev(r, "a")).toBe(0);
    expect(basis(r, "a")).toBe("NO_REVENUE");
  });

  test("a priced custom item takes its set price off the pool; gear splits the rest", () => {
    // The real use case: a group priced at $2,000 with $1,800 of custom gear and a
    // couple of headsets. The headsets must get ~$200, not the whole $2,000.
    const r = run(
      [
        L("headsets", { groupId: "g1", modelId: "hs", lineTotal: 200, sortOrder: 1 }),
        L("customGear", { groupId: "g1", lineTotal: 1800, isCustomItem: true, sortOrder: 2 }),
      ],
      { groups: [{ id: "g1", price: 2000, quantity: 1 }] },
    );
    expect(rev(r, "headsets")).toBe(200);
    expect(rev(r, "customGear")).toBe(1800);
    // The custom's $1,800 is stored but stays OUT of ROI — it's not a model.
    expect(basis(r, "customGear")).toBe("EXCLUDED_NON_GEAR");
    expect(sumOf(r, ["headsets", "customGear"])).toBe(2000);
    // Only the headsets' $200 reaches model ROI.
    expect(rollupByModel([L("headsets", { modelId: "hs" })], r).get("hs")).toBe(200);
  });

  test("several custom items each come off the top before gear splits", () => {
    const r = run(
      [
        L("gear", { groupId: "g1", modelId: "m1", lineTotal: 100, sortOrder: 1 }),
        L("c1", { groupId: "g1", lineTotal: 300, isCustomItem: true, sortOrder: 2 }),
        L("c2", { groupId: "g1", lineTotal: 200, isCustomItem: true, sortOrder: 3 }),
      ],
      { groups: [{ id: "g1", price: 1000, quantity: 1 }] },
    );
    expect(rev(r, "c1")).toBe(300);
    expect(rev(r, "c2")).toBe(200);
    expect(rev(r, "gear")).toBe(500); // 1000 - 300 - 200
    expect(sumOf(r, ["gear", "c1", "c2"])).toBe(1000);
  });

  test("a $0 custom item consumes nothing — gear keeps the whole pool", () => {
    const r = run(
      [
        L("gear", { groupId: "g1", modelId: "m1", lineTotal: 100, sortOrder: 1 }),
        L("note", { groupId: "g1", lineTotal: 0, isCustomItem: true, sortOrder: 2 }),
      ],
      { groups: [{ id: "g1", price: 500, quantity: 1 }] },
    );
    expect(rev(r, "gear")).toBe(500);
    expect(rev(r, "note")).toBe(0);
  });

  test("a priced group of custom-only items attributes the whole pool (nothing dropped)", () => {
    // No gear to take the remainder, so the customs must absorb the full pool —
    // otherwise the leftover ($100 − $40) would silently vanish.
    const r = run(
      [L("c", { groupId: "g1", lineTotal: 40, isCustomItem: true, sortOrder: 1 })],
      { groups: [{ id: "g1", price: 100, quantity: 1 }] },
    );
    expect(rev(r, "c")).toBe(100);
    expect(basis(r, "c")).toBe("EXCLUDED_NON_GEAR");
    expect(sumOf(r, ["c"])).toBe(100);
  });

  test("custom priced above the group total leaves gear at zero, pool still balances", () => {
    const r = run(
      [
        L("gear", { groupId: "g1", modelId: "m1", lineTotal: 100, sortOrder: 1 }),
        L("big", { groupId: "g1", lineTotal: 5000, isCustomItem: true, sortOrder: 2 }),
      ],
      { groups: [{ id: "g1", price: 1000, quantity: 1 }] },
    );
    expect(rev(r, "gear")).toBe(0);
    expect(basis(r, "gear")).toBe("NO_REVENUE");
    expect(rev(r, "big")).toBe(1000); // capped at the pool
    expect(sumOf(r, ["gear", "big"])).toBe(1000);
  });

  test("per-item: a group mixes a priced, a rate-only and a cost-only item, all fairly", () => {
    // Each item weighted by its own best signal, all in the same unit:
    //   A = its set price 300; B = its rate 100; C = cost 4000 × 0.02 = 80.
    const r = run(
      [
        L("priced", { groupId: "g1", modelId: "m1", lineTotal: 300, sortOrder: 1 }),
        L("rateOnly", { groupId: "g1", modelId: "m2", sortOrder: 2 }),
        L("costOnly", { groupId: "g1", modelId: "m3", sortOrder: 3 }),
      ],
      {
        groups: [{ id: "g1", price: 960, quantity: 1 }],
        rateFactor: 0.02,
        models: models(
          M("m2", { dailyRate: 100 }), // rate only
          M("m3", { replacementCost: 4000 }), // cost only
        ),
      },
    );
    // Weights 300 : 100 : 80 → of $960: 600 : 200 : 160.
    expect(rev(r, "priced")).toBe(600);
    expect(rev(r, "rateOnly")).toBe(200);
    expect(rev(r, "costOnly")).toBe(160); // not $0
    expect(sumOf(r, ["priced", "rateOnly", "costOnly"])).toBe(960);
  });

  test("an all-cost group splits purely by cost — the rate factor cancels out", () => {
    // Every item falls to its cost, so the factor is a common multiplier and
    // disappears from the ratio. Split is 200 : 500 : 300.
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", sortOrder: 2 }),
        L("c", { groupId: "g1", modelId: "m3", sortOrder: 3 }),
      ],
      {
        groups: [{ id: "g1", price: 1000, quantity: 1 }],
        models: models(
          M("m1", { replacementCost: 200 }),
          M("m2", { replacementCost: 500 }),
          M("m3", { replacementCost: 300 }),
        ),
      },
    );
    expect(rev(r, "a")).toBe(200);
    expect(rev(r, "b")).toBe(500);
    expect(rev(r, "c")).toBe(300);
  });

  test("a PRICED kit in a group weighs by its kit price, not price + contents", () => {
    // Regression: subtreeWeight once added a priced kit's own price AND its
    // children, so a $100 kit next to $100 of loose gear took two-thirds instead of
    // half. A priced node's price is the whole value of its contents.
    const r = run(
      [
        L("kit", { groupId: "g1", kitId: "k1", lineTotal: 100, sortOrder: 1 }),
        L("child", { parentLineItemId: "kit", modelId: "m1", sortOrder: 1 }),
        L("loose", { groupId: "g1", modelId: "m2", lineTotal: 100, sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 200, quantity: 1 }],
        models: models(M("m1", { dailyRate: 100 })), // child has a rate — must NOT be added
      },
    );
    // kit weighs 100 (its price), loose weighs 100 → even split.
    expect(rev(r, "child")).toBe(100); // the kit's whole $100 slice
    expect(rev(r, "loose")).toBe(100);
    expect(sumOf(r, ["child", "loose"])).toBe(200);
  });

  test("a FULLY-rated group splits by hire rate, not cost", () => {
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 400, quantity: 1 }],
        models: models(
          M("m1", { dailyRate: 300, replacementCost: 10 }),
          M("m2", { dailyRate: 100, replacementCost: 9000 }),
        ),
      },
    );
    expect(rev(r, "a")).toBe(300); // by rate 300:100, NOT by cost 10:9000
    expect(rev(r, "b")).toBe(100);
  });

  test("weekly rental periods weight on weeklyRate", () => {
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 100, quantity: 1 }],
        models: models(
          M("m1", { dailyRate: 50, weeklyRate: 30 }),
          M("m2", { dailyRate: 50, weeklyRate: 70 }),
        ),
        rentalPeriod: "WEEKLY",
      },
    );
    expect(rev(r, "a")).toBe(30);
    expect(rev(r, "b")).toBe(70);
  });
});

// ── sub-hire ─────────────────────────────────────────────────────────────────

describe("sub-hire lines", () => {
  test("consume pool weight but never count as our revenue", () => {
    const r = run(
      [
        L("owned", { groupId: "g1", modelId: "m1", lineTotal: 100, sortOrder: 1 }),
        L("hired", { groupId: "g1", modelId: "m1", lineTotal: 100, subHireId: "sh1", sortOrder: 2 }),
      ],
      { groups: [{ id: "g1", price: 200, quantity: 1 }] },
    );

    // Owned gear takes its honest half — not the whole $200.
    expect(rev(r, "owned")).toBe(100);
    expect(basis(r, "owned")).toBe("WEIGHTED");
    expect(rev(r, "hired")).toBe(100);
    expect(basis(r, "hired")).toBe("EXCLUDED_SUBHIRE");

    // ...and only the owned half reaches model ROI, even though both rows carry m1.
    const lines = [
      L("owned", { modelId: "m1" }),
      L("hired", { modelId: "m1", subHireId: "sh1" }),
    ];
    expect(rollupByModel(lines, r).get("m1")).toBe(100);
  });

  test("a sub-hire subtree is excluded wholesale", () => {
    const r = run([
      L("shg", { lineTotal: 500, subHireId: "sh1", kitId: "k1" }),
      L("child", { parentLineItemId: "shg", modelId: "m1", subHireId: "sh1" }),
    ]);
    expect(basis(r, "child")).toBe("EXCLUDED_SUBHIRE");
    expect(isRoiCounted(basis(r, "child"))).toBe(false);
  });
});

// ── composition ──────────────────────────────────────────────────────────────

describe("composition", () => {
  test("a kit inside a group: the group slice flows down to the kit's children", () => {
    const r = run(
      [
        L("kit", { groupId: "g1", kitId: "k1", lineTotal: 900, sortOrder: 1 }),
        L("rx", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("bp", { parentLineItemId: "kit", modelId: "bp", sortOrder: 2 }),
        L("loose", { groupId: "g1", modelId: "loose", lineTotal: 100, sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 500, quantity: 1 }],
        kitAllocations: kitAlloc("k1", { rx: 70, bp: 30 }),
      },
    );

    // Group: kit is worth 900 of 1000 nominal → $450; loose gear takes $50.
    expect(rev(r, "loose")).toBe(50);
    // Kit layer: that $450 splits 70/30, per the kit's saved allocation.
    expect(rev(r, "rx")).toBe(315);
    expect(rev(r, "bp")).toBe(135);
    expect(basis(r, "rx")).toBe("KIT_PERCENT");
    expect(sumOf(r, ["rx", "bp", "loose"])).toBe(500);
  });

  test("an unpriced kit in a group is still weighted by its contents' nominal value", () => {
    const r = run(
      [
        L("kit", { groupId: "g1", kitId: "k1", sortOrder: 1 }),
        L("rx", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("loose", { groupId: "g1", modelId: "loose", sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 400, quantity: 1 }],
        models: models(M("rx", { dailyRate: 300 }), M("loose", { dailyRate: 100 })),
      },
    );
    // The kit has no lineTotal of its own, so rule 2 can't apply to the group's
    // members; rule 3 values the kit at the sum of its contents.
    expect(rev(r, "rx")).toBe(300);
    expect(rev(r, "loose")).toBe(100);
  });

  test("accessories take a share of their parent's line — they are not free", () => {
    const r = run(
      [
        L("hh", { modelId: "hh", lineTotal: 206, sortOrder: 1 }),
        L("batt", {
          parentLineItemId: "hh",
          modelId: "batt",
          sortOrder: 2,
        }),
      ],
      { models: models(M("hh", { dailyRate: 100 }), M("batt", { dailyRate: 3 })) },
    );
    // The parent is both a leaf and a container: it keeps its own share.
    expect(rev(r, "hh")).toBe(200);
    expect(rev(r, "batt")).toBe(6);
    expect(sumOf(r, ["hh", "batt"])).toBe(206);
  });

  test("three levels deep: group → kit → child → accessory", () => {
    const r = run(
      [
        L("kit", { groupId: "g1", kitId: "k1", lineTotal: 100, sortOrder: 1 }),
        L("rx", { parentLineItemId: "kit", modelId: "rx", sortOrder: 1 }),
        L("psu", { parentLineItemId: "rx", modelId: "psu", sortOrder: 1 }),
      ],
      {
        groups: [{ id: "g1", price: 100, quantity: 1 }],
        models: models(M("rx", { dailyRate: 90 }), M("psu", { dailyRate: 10 })),
      },
    );
    expect(rev(r, "rx")).toBe(90);
    expect(rev(r, "psu")).toBe(10);
    expect(sumOf(r, ["rx", "psu"])).toBe(100);
  });
});

// ── rollup ───────────────────────────────────────────────────────────────────

describe("$0 items are excluded from the split", () => {
  test("an explicit $0 gear item takes no share; the rest split the whole pool", () => {
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", lineTotal: 600, sortOrder: 1 }),
        L("free", { groupId: "g1", modelId: "m2", lineTotal: 0, sortOrder: 2 }),
        L("b", { groupId: "g1", modelId: "m3", lineTotal: 400, sortOrder: 3 }),
      ],
      { groups: [{ id: "g1", price: 1000, quantity: 1 }] },
    );
    expect(rev(r, "free")).toBe(0);
    expect(basis(r, "free")).toBe("NO_REVENUE");
    // a and b split the full $1,000 by their prices (600:400), free gets nothing.
    expect(rev(r, "a")).toBe(600);
    expect(rev(r, "b")).toBe(400);
    expect(sumOf(r, ["a", "b", "free"])).toBe(1000);
  });

  test("$0 is excluded even when the rest of the group is on rate/cost", () => {
    // "free" has a rated model but is priced $0 → still excluded (not a rate share).
    const r = run(
      [
        L("a", { groupId: "g1", modelId: "m1", sortOrder: 1 }),
        L("free", { groupId: "g1", modelId: "m2", lineTotal: 0, sortOrder: 2 }),
      ],
      {
        groups: [{ id: "g1", price: 500, quantity: 1 }],
        models: models(M("m1", { dailyRate: 100 }), M("m2", { dailyRate: 100 })),
      },
    );
    expect(rev(r, "free")).toBe(0);
    expect(rev(r, "a")).toBe(500); // takes the whole pool
  });

  test("a freebie nested under a sub-hire is still $0, not the sub-hire's audit value", () => {
    // The sub-hire subtree is stamped wholesale with its pool value; the freebie
    // must be forced back to $0 so it never shows a non-zero number.
    const r = run([
      L("sh", { lineTotal: 100, subHireId: "s1", kitId: "k1", sortOrder: 1 }),
      L("free", { parentLineItemId: "sh", modelId: "m1", lineTotal: 0, subHireId: "s1", sortOrder: 1 }),
    ]);
    expect(rev(r, "free")).toBe(0);
    expect(basis(r, "free")).toBe("NO_REVENUE");
  });

  test("$0 and '—' behave differently: $0 excluded, '—' earns via its rate", () => {
    const r = run(
      [
        L("priced", { groupId: "g1", modelId: "m1", sortOrder: 1 }),
        L("dash", { groupId: "g1", modelId: "m2", sortOrder: 2 }), // lineTotal undefined
        L("zero", { groupId: "g1", modelId: "m3", lineTotal: 0, sortOrder: 3 }),
      ],
      {
        groups: [{ id: "g1", price: 300, quantity: 1 }],
        models: models(
          M("m1", { dailyRate: 100 }),
          M("m2", { dailyRate: 200 }), // "—" line → uses this rate
          M("m3", { dailyRate: 999 }), // ignored: line is $0
        ),
      },
    );
    expect(rev(r, "zero")).toBe(0);
    // priced + dash split $300 by rate 100:200.
    expect(rev(r, "priced")).toBe(100);
    expect(rev(r, "dash")).toBe(200);
  });
});

describe("deriveRateFactor", () => {
  const M2 = (rate: number | null, cost: number | null): AllocModel => ({
    id: `m${rate}-${cost}`,
    dailyRate: rate ?? undefined,
    replacementCost: cost ?? undefined,
  });

  test("returns the median rate/cost ratio over models that have both", () => {
    const f = deriveRateFactor(
      [M2(20, 1000), M2(30, 1000), M2(40, 1000)], // ratios 0.02, 0.03, 0.04
      false,
    );
    expect(f).toBe(0.03);
  });

  test("ignores models missing a rate or a cost", () => {
    const f = deriveRateFactor(
      [M2(20, 1000), M2(null, 1000), M2(40, 1000), M2(60, 1000)], // 0.02, 0.04, 0.06
      false,
    );
    expect(f).toBe(0.04);
  });

  test("returns null when fewer than 3 models carry both (too little to trust)", () => {
    expect(deriveRateFactor([M2(20, 1000), M2(30, 1000)], false)).toBeNull();
    expect(deriveRateFactor([], false)).toBeNull();
  });
});

describe("rollupByModel", () => {
  test("sums a model across every line that earned for it", () => {
    const lines = [
      L("a", { modelId: "m1", lineTotal: 100 }),
      L("b", { modelId: "m1", lineTotal: 50 }),
      L("c", { modelId: "m2", lineTotal: 25 }),
    ];
    const totals = rollupByModel(lines, run(lines));
    expect(totals.get("m1")).toBe(150);
    expect(totals.get("m2")).toBe(25);
  });

  test("skips containers, custom items, and cancelled lines", () => {
    const lines = [
      L("kit", { kitId: "k1", lineTotal: 100 }),
      L("rx", { parentLineItemId: "kit", modelId: "rx" }),
      L("custom", { lineTotal: 900, isCustomItem: true }),
      L("dead", { modelId: "rx", lineTotal: 900, status: "CANCELLED" }),
    ];
    const totals = rollupByModel(lines, run(lines));
    expect(totals.get("rx")).toBe(100);
    expect(totals.size).toBe(1);
  });
});

// ── project discount ─────────────────────────────────────────────────────────

describe("project discount", () => {
  test("allocates what was billed, not what was listed", () => {
    // recalcProjectTotals applies discountPercent to the subtotal; the group and
    // line prices the allocation pass reads are pre-discount.
    const r = allocateProject({
      lines: [L("a", { modelId: "m1", lineTotal: 200 })],
      groups: [],
      models: new Map(),
      kitAllocations: noKits,
      revenueFactor: 0.75,
    });
    expect(rev(r, "a")).toBe(150);
  });

  test("a fully discounted job credits no gear with revenue", () => {
    const r = allocateProject({
      lines: [L("a", { groupId: "g1", modelId: "m1", lineTotal: 100 })],
      groups: [{ id: "g1", price: 900, quantity: 1 }],
      models: new Map(),
      kitAllocations: noKits,
      revenueFactor: 0,
    });
    expect(rev(r, "a")).toBe(0);
    expect(basis(r, "a")).toBe("NO_REVENUE");
  });

  test("the discounted pool still splits to the cent", () => {
    const r = allocateProject({
      lines: [
        L("a", { groupId: "g1", modelId: "m1", lineTotal: 1, sortOrder: 1 }),
        L("b", { groupId: "g1", modelId: "m2", lineTotal: 1, sortOrder: 2 }),
        L("c", { groupId: "g1", modelId: "m3", lineTotal: 1, sortOrder: 3 }),
      ],
      groups: [{ id: "g1", price: 100, quantity: 1 }],
      models: new Map(),
      kitAllocations: noKits,
      revenueFactor: 1 - 33 / 100,
    });
    expect(sumOf(r, ["a", "b", "c"])).toBe(67);
  });

  test("a nonsense discount is clamped rather than inventing revenue", () => {
    const over = allocateProject({
      lines: [L("a", { modelId: "m1", lineTotal: 100 })],
      groups: [], models: new Map(), kitAllocations: noKits, revenueFactor: 1.5,
    });
    expect(rev(over, "a")).toBe(100);

    const under = allocateProject({
      lines: [L("a", { modelId: "m1", lineTotal: 100 })],
      groups: [], models: new Map(), kitAllocations: noKits, revenueFactor: -0.5,
    });
    expect(rev(under, "a")).toBe(0);
  });
});

// ── kit allocation helpers ───────────────────────────────────────────────────

describe("suggestKitAllocation", () => {
  test("weights by replacement cost × quantity and sums to exactly 100", () => {
    const s = suggestKitAllocation([
      { modelId: "rx", quantity: 4, replacementCost: 2000 },
      { modelId: "belt", quantity: 4, replacementCost: 15 },
      { modelId: "case", quantity: 1, replacementCost: 200 },
    ]);
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.get("rx")!).toBeGreaterThan(s.get("case")!);
    expect(s.get("case")!).toBeGreaterThan(s.get("belt")!);
  });

  test("thirds still sum to 100 — the panel never opens on a split it would reject", () => {
    const s = suggestKitAllocation([
      { modelId: "a", quantity: 1, replacementCost: 10 },
      { modelId: "b", quantity: 1, replacementCost: 10 },
      { modelId: "c", quantity: 1, replacementCost: 10 },
    ]);
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("no replacement cost anywhere falls back to an equal split", () => {
    const s = suggestKitAllocation([
      { modelId: "a", quantity: 1, replacementCost: null },
      { modelId: "b", quantity: 3, replacementCost: null },
    ]);
    expect(s.get("a")).toBe(50);
    expect(s.get("b")).toBe(50);
  });

  test("an empty kit suggests nothing", () => {
    expect(suggestKitAllocation([]).size).toBe(0);
  });
});

describe("allocationCoversKit", () => {
  const saved = new Map([["a", 60], ["b", 40]]);

  test("exact cover", () => {
    expect(allocationCoversKit(saved, ["a", "b"])).toBe(true);
    // Duplicate rows of the same model are one model as far as cover goes.
    expect(allocationCoversKit(saved, ["a", "a", "b"])).toBe(true);
  });

  test("a model the kit gained leaves it uncovered", () => {
    expect(allocationCoversKit(saved, ["a", "b", "c"])).toBe(false);
  });

  test("a model the kit lost also leaves it stale", () => {
    // The remaining percentages no longer add to 100% of what's in the case.
    expect(allocationCoversKit(saved, ["a"])).toBe(false);
  });
});

// ── stability ────────────────────────────────────────────────────────────────

describe("stability", () => {
  test("recomputing an unchanged project produces identical cents", () => {
    // If this drifts, every no-op write dirties the diff and patches every line.
    const build = () => [
      L("kit", { kitId: "k1", lineTotal: 1000 }),
      L("a", { parentLineItemId: "kit", modelId: "m1", sortOrder: 1 }),
      L("b", { parentLineItemId: "kit", modelId: "m2", sortOrder: 2 }),
      L("c", { parentLineItemId: "kit", modelId: "m3", sortOrder: 3 }),
    ];
    const first = run(build());
    const second = run(build());
    for (const id of ["a", "b", "c"]) expect(rev(second, id)).toBe(rev(first, id));
    expect(sumOf(first, ["a", "b", "c"])).toBe(1000);
  });

  test("every line gets a verdict, even an orphan whose parent is gone", () => {
    const r = run([L("orphan", { parentLineItemId: "missing", modelId: "m1", lineTotal: 10 })]);
    expect(r.has("orphan")).toBe(true);
    // Treated as a root rather than silently dropped.
    expect(rev(r, "orphan")).toBe(10);
  });

  test("a parent cycle doesn't strand the pool, hang, or blow the stack", () => {
    // No line in a cycle is a root, so nothing would traverse it and the kit's $100
    // would silently vanish from every model inside it.
    const r = run(
      [
        L("a", { parentLineItemId: "b", kitId: "k1", lineTotal: 100, sortOrder: 1 }),
        L("b", { parentLineItemId: "a", modelId: "m1", sortOrder: 2 }),
      ],
      { models: models(M("m1", { dailyRate: 5 })) },
    );
    expect(sumOf(r, ["b"])).toBe(100);
  });

  test("a self-parenting line still gets allocated", () => {
    const r = run([L("a", { parentLineItemId: "a", modelId: "m1", lineTotal: 42 })]);
    expect(rev(r, "a")).toBe(42);
  });

  test("a three-line cycle terminates and allocates the whole pool", () => {
    const r = run(
      [
        L("a", { parentLineItemId: "c", modelId: "m1", lineTotal: 90, sortOrder: 1 }),
        L("b", { parentLineItemId: "a", modelId: "m2", sortOrder: 2 }),
        L("c", { parentLineItemId: "b", modelId: "m3", sortOrder: 3 }),
      ],
      {
        models: models(
          M("m1", { dailyRate: 1 }),
          M("m2", { dailyRate: 1 }),
          M("m3", { dailyRate: 1 }),
        ),
      },
    );
    expect(sumOf(r, ["a", "b", "c"])).toBe(90);
  });
});

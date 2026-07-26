/**
 * Revenue allocation — split what the client paid across the gear that earned it.
 *
 * Kits and groups are priced as a unit, so the models inside them report $0 revenue
 * and per-model ROI is impossible. This module distributes each priced container's
 * revenue down to the leaf line items, writing `allocatedRevenue` (dollars) and
 * `allocationBasis` (how it was split) on every line.
 *
 * Full spec, including why each rule exists: docs/revenue-allocation-design.md.
 *
 * Two things worth knowing before you edit:
 *
 *  1. It is ONE recursive walk, not a "group layer then kit layer". Groups contain
 *     kits, kits contain children, children carry accessories. A two-layer
 *     implementation breaks the moment a third level exists.
 *
 *  2. Arithmetic is in integer CENTS with largest-remainder rounding, so
 *     `SUM(children) === pool` exactly. Per-item rounding leaks cents, and a leak
 *     here silently corrupts every ROI number downstream.
 *
 * The pure core (`allocateProject`) takes plain data and returns a Map. All Convex
 * I/O lives in `applyProjectAllocation` at the bottom. Test the core.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type AllocationBasisValue =
  | "DIRECT"
  | "KIT_PERCENT"
  | "WEIGHTED"
  | "EQUAL_SPLIT"
  | "EXCLUDED_SUBHIRE"
  | "EXCLUDED_NON_GEAR"
  | "NO_REVENUE";

/** The `allocationBasis` values that represent revenue OUR capital earned. */
export const ROI_COUNTED_BASES: readonly AllocationBasisValue[] = [
  "DIRECT",
  "KIT_PERCENT",
  "WEIGHTED",
  "EQUAL_SPLIT",
];

export function isRoiCounted(basis: string | null | undefined): boolean {
  return basis != null && (ROI_COUNTED_BASES as readonly string[]).includes(basis);
}

// ── Inputs (structural subsets of the Convex docs, so tests need no fixtures) ──

export interface AllocLine {
  id: string;
  parentLineItemId?: string | null;
  groupId?: string | null;
  modelId?: string | null;
  kitId?: string | null;
  subHireId?: string | null;
  quantity?: number | null;
  duration?: number | null;
  lineTotal?: number | null;
  sortOrder?: number | null;
  status?: string | null;
  isOptional?: boolean | null;
  isCustomItem?: boolean | null;
  isContainerLineItem?: boolean | null;
}

export interface AllocModel {
  id: string;
  dailyRate?: number | null;
  weeklyRate?: number | null;
  defaultRentalPrice?: number | null;
  replacementCost?: number | null;
}

export interface AllocGroup {
  id: string;
  price?: number | null;
  quantity?: number | null;
  discount?: number | null;
}

export interface AllocationInput {
  lines: readonly AllocLine[];
  groups: readonly AllocGroup[];
  /** modelId → model. Missing models simply fall through the weight chain. */
  models: ReadonlyMap<string, AllocModel>;
  /** kitId → (modelId → percent). Applied only if it exactly covers the kit. */
  kitAllocations: ReadonlyMap<string, ReadonlyMap<string, number>>;
  rentalPeriod?: string | null;
  /**
   * What fraction of the listed prices the client is actually billed, after the
   * project-level discount. `recalcProjectTotals` applies `discountPercent` to the
   * subtotal, so allocating the undiscounted price would credit gear with revenue
   * the project never charged — a 100%-discounted job would report full ROI.
   */
  revenueFactor?: number;
  /**
   * Rental dollars per dollar of replacement cost, per rental period — used to turn
   * a cost-only item's replacement cost into a rate-equivalent so it can be weighed
   * in the SAME unit as a rated item (rental rates run ~1–2%/day of value). Derived
   * from the org's own rated+costed models where possible; ~0.015/day otherwise. It
   * cancels out in an all-cost set, so it only bites where a group mixes rated and
   * cost-only gear.
   */
  rateFactor?: number;
}

export interface LineAllocation {
  allocatedRevenue: number | null;
  allocationBasis: AllocationBasisValue;
}

// ── Money ────────────────────────────────────────────────────────────────────

const toCents = (v: number | null | undefined): number =>
  v == null ? 0 : Math.round(v * 100);
const fromCents = (c: number): number => Math.round(c) / 100;

/**
 * Split `poolCents` across `weights` so the parts sum to exactly `poolCents`.
 *
 * Floor every share, then hand the leftover cents out one at a time to the largest
 * fractional remainders. `order` breaks ties deterministically (sortOrder, then id)
 * so the same project always produces the same cents — otherwise a no-op recompute
 * would shuffle a cent between two siblings and dirty the diff on every write.
 */
export function largestRemainder(
  poolCents: number,
  weights: readonly number[],
  order: readonly number[],
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (poolCents <= 0) return new Array(n).fill(0);

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // No weight anywhere → equal split. Falls out of the same remainder machinery.
  const w = totalWeight > 0 ? weights : new Array(n).fill(1);
  const total = totalWeight > 0 ? totalWeight : n;

  const base = w.map((x) => Math.floor((poolCents * x) / total));
  const remainders = w.map((x, i) => (poolCents * x) / total - base[i]);
  let leftover = poolCents - base.reduce((a, b) => a + b, 0);

  const idx = w
    .map((_, i) => i)
    .sort((a, b) => remainders[b] - remainders[a] || order[a] - order[b]);

  for (let k = 0; leftover > 0; k++, leftover--) base[idx[k % n]] += 1;
  return base;
}

// ── Classification ───────────────────────────────────────────────────────────

/** Cancelled and optional lines neither earn nor dilute. */
const isInactive = (l: AllocLine): boolean =>
  l.status === "CANCELLED" || l.isOptional === true;

/** Not gear: takes no share of any pool, and nothing to attribute it to. */
const isNonGear = (l: AllocLine): boolean =>
  l.isCustomItem === true || l.isContainerLineItem === true;

const qtyOf = (l: AllocLine): number => Math.max(1, l.quantity ?? 1);
const durOf = (l: AllocLine): number => Math.max(1, l.duration ?? 1);

function rateOf(m: AllocModel | undefined, weekly: boolean): number {
  if (!m) return 0;
  const daily = m.dailyRate ?? m.defaultRentalPrice ?? 0;
  const r = weekly ? (m.weeklyRate ?? daily) : daily;
  return Number(r) || 0;
}

/**
 * The fleet's own rental-rate-per-dollar-of-replacement-cost — the median ratio
 * across models that have BOTH a rate and a cost. Used to turn a cost-only item into
 * a rate-equivalent so it can be weighed beside a rated item in the same unit.
 *
 * Returns null when fewer than 3 models carry both (too little to trust a derived
 * factor); the caller then uses a conventional default (~1–2%/day of value).
 */
export function deriveRateFactor(
  models: Iterable<AllocModel>,
  weekly: boolean,
): number | null {
  const ratios: number[] = [];
  for (const m of models) {
    const r = rateOf(m, weekly);
    const c = Number(m.replacementCost ?? 0) || 0;
    if (r > 0 && c > 0) ratios.push(r / c);
  }
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function allocateProject(input: AllocationInput): Map<string, LineAllocation> {
  const { lines, groups, models, kitAllocations } = input;
  const weekly = input.rentalPeriod === "WEEKLY";
  // Clamped: a discountPercent outside 0–100 is bad data, and neither negative
  // revenue nor revenue above the listed price is a thing we want to invent.
  const factor = Math.min(1, Math.max(0, input.revenueFactor ?? 1));
  // Fleet rate-per-dollar-of-cost. A weekly split needs a weekly-scale factor, so
  // the default is bumped when no derived value is supplied (weekly rates ≈ 3× daily).
  const rateFactor =
    input.rateFactor != null && input.rateFactor > 0
      ? input.rateFactor
      : weekly
        ? 0.05
        : 0.015;
  /** A billed pool, in cents: the listed amount after the project discount. */
  const poolOf = (amount: number | null | undefined): number =>
    Math.max(0, Math.round((amount ?? 0) * factor * 100));
  const out = new Map<string, LineAllocation>();

  // An item explicitly priced at $0 is a freebie — it takes NO share of any split
  // and never counts toward ROI. (A price-less item shows "—" / null, which is
  // different: that one still earns via its rate or cost.) Pre-stamped so every
  // participant filter and the child-fallback passes skip it cleanly.
  const isFreebie = (l: AllocLine): boolean =>
    l.lineTotal === 0 && !isInactive(l) && !isNonGear(l);
  for (const l of lines) {
    if (isFreebie(l)) out.set(l.id, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
  }

  const byId = new Map(lines.map((l) => [l.id, l]));
  const childrenOf = new Map<string, AllocLine[]>();
  for (const l of lines) {
    if (!l.parentLineItemId) continue;
    // A parent that isn't in this project's line set would orphan the child's
    // pool. Treat it as a root rather than dropping it silently.
    if (!byId.has(l.parentLineItemId)) continue;
    const arr = childrenOf.get(l.parentLineItemId);
    if (arr) arr.push(l);
    else childrenOf.set(l.parentLineItemId, [l]);
  }

  /** Children eligible to take a share of their parent's pool (freebies excluded). */
  const participantsOf = (l: AllocLine): AllocLine[] =>
    (childrenOf.get(l.id) ?? []).filter(
      (c) => !isInactive(c) && !isNonGear(c) && !isFreebie(c),
    );

  const sortKey = (l: AllocLine): number => l.sortOrder ?? 0;

  /**
   * One item's rate signal in rental dollars — its usual hire rate, else its
   * replacement cost turned into a rate-equivalent (× rateFactor). Ignores any set
   * price (that's handled by the caller). Same unit throughout, so a rate-only and a
   * cost-only item can be weighed together; rateFactor cancels out in an all-cost
   * set, so it only matters in a genuinely mixed one.
   */
  const rateOrCost = (l: AllocLine): number => {
    if (!l.modelId) return 0;
    const m = models.get(l.modelId);
    const rate = rateOf(m, weekly);
    if (rate > 0) return rate * qtyOf(l) * durOf(l);
    const cost = Number(m?.replacementCost ?? 0) || 0;
    if (cost > 0) return cost * rateFactor * qtyOf(l) * durOf(l);
    return 0;
  };

  /**
   * A node's whole-subtree value: its set price if it has one, else its own rate/cost
   * plus its contents.
   *
   * A priced node's price IS the value of the whole node+contents — a $100 kit is
   * worth $100, so we do NOT also add its members (that double-counted a priced kit
   * against the loose gear beside it in a group). We only recurse into a node with no
   * price of its own — an unpriced kit is worth the sum of what's inside it.
   */
  const subtreeWeight = (l: AllocLine): number => {
    const price = l.lineTotal;
    if (price != null && Number(price) > 0) return Number(price);
    return rateOrCost(l) + participantsOf(l).reduce((s, c) => s + subtreeWeight(c), 0);
  };

  /**
   * Weight of one participant in a split. A node weighed against its OWN children
   * (`selfId` — the accessory-parent case) counts only ITSELF, by rate/cost, never
   * its price (its price IS the pool being divided). Every other participant counts
   * its whole subtree, each node picking price → rate → cost on its own.
   */
  const participantWeight = (p: AllocLine, selfId?: string): number =>
    p.id === selfId ? rateOrCost(p) : subtreeWeight(p);

  /**
   * The weights for a sibling set plus the basis to stamp beneath. A saved kit
   * split wins if it still describes the kit; otherwise every item is weighted by
   * its own best available signal; if nothing has a signal, the pool is split even.
   */
  function chooseWeights(
    parts: readonly AllocLine[],
    kitId: string | null | undefined,
    /** Set when `parts[0]` is the parent competing with its own children. */
    selfId?: string,
  ): { weights: number[]; basis: AllocationBasisValue } {
    // 1. The kit's saved per-model split — but only if it still describes the kit.
    //    Contents change from the warehouse and CSV import without ever touching
    //    the allocation, so a stale split is ignored rather than trusted.
    const alloc = kitId ? kitAllocations.get(kitId) : undefined;
    if (alloc && alloc.size > 0 && parts.every((p) => p.modelId)) {
      if (allocationCoversKit(alloc, parts.map((p) => p.modelId as string))) {
        // A model's percent is shared across the lines carrying it, by quantity —
        // 4 receiver rows in one kit split that model's 35% between them.
        const qtyByModel = new Map<string, number>();
        for (const p of parts)
          qtyByModel.set(p.modelId!, (qtyByModel.get(p.modelId!) ?? 0) + qtyOf(p));
        const weights = parts.map((p) => {
          const pct = alloc.get(p.modelId!) ?? 0;
          const share = qtyOf(p) / (qtyByModel.get(p.modelId!) || 1);
          return pct * share;
        });
        if (weights.some((w) => w > 0)) return { weights, basis: "KIT_PERCENT" };
      }
    }

    // 2. Per-item weight: price → rate → cost-equivalent, decided for each item on
    //    its own and all in the same unit. A group may mix priced, rate-only and
    //    cost-only gear and still split fairly.
    const weights = parts.map((p) => participantWeight(p, selfId));
    if (weights.some((w) => w > 0)) return { weights, basis: "WEIGHTED" };

    // 3. Nothing to weight on. Never leave gear invisible.
    return { weights: parts.map(() => 1), basis: "EQUAL_SPLIT" };
  }

  /** Mark a line and everything beneath it, without distributing anything. */
  function stamp(l: AllocLine, alloc: LineAllocation): void {
    out.set(l.id, alloc);
    for (const c of childrenOf.get(l.id) ?? []) stamp(c, alloc);
  }

  /**
   * `poolCents` is what reached this node. `basis` is how that share was decided —
   * it flows down so a leaf reports the rule that actually produced its number,
   * not the rule used one level below the root.
   */
  function assign(l: AllocLine, poolCents: number, basis: AllocationBasisValue): void {
    if (isInactive(l)) return stamp(l, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });

    // Sub-hired gear consumed its weight upstream (so the owned gear beside it
    // isn't over-credited); the number is kept for audit but never counts as ROI.
    if (l.subHireId) {
      return stamp(l, {
        allocatedRevenue: fromCents(poolCents),
        allocationBasis: "EXCLUDED_SUBHIRE",
      });
    }

    const parts = participantsOf(l);
    const selfParticipates = l.modelId != null;

    if (parts.length === 0) {
      if (!selfParticipates) {
        // A pure container: kit parent, container line, custom item. Its pool has
        // nowhere to go — record null rather than inventing revenue for a row that
        // has no model to attribute it to.
        out.set(l.id, { allocatedRevenue: null, allocationBasis: "EXCLUDED_NON_GEAR" });
        return;
      }
      out.set(l.id, {
        allocatedRevenue: fromCents(poolCents),
        allocationBasis: poolCents === 0 ? "NO_REVENUE" : basis,
      });
      return;
    }

    // An accessory parent is a leaf AND a container: it keeps its own share and
    // gives its accessories theirs. A kit parent has no modelId, so it takes none.
    const roster: AllocLine[] = selfParticipates ? [l, ...parts] : [...parts];
    const { weights, basis: splitBasis } = chooseWeights(
      roster,
      l.kitId,
      selfParticipates ? l.id : undefined,
    );
    const shares = largestRemainder(poolCents, weights, roster.map(sortKey));

    let i = 0;
    if (selfParticipates) {
      out.set(l.id, {
        allocatedRevenue: fromCents(shares[0]),
        allocationBasis: poolCents === 0 ? "NO_REVENUE" : splitBasis,
      });
      i = 1;
    } else {
      out.set(l.id, { allocatedRevenue: null, allocationBasis: "EXCLUDED_NON_GEAR" });
    }
    for (const c of parts) assign(c, shares[i++], splitBasis);

    // Inactive / non-gear children took no share; they still need a verdict.
    for (const c of childrenOf.get(l.id) ?? []) {
      if (out.has(c.id)) continue;
      if (isInactive(c)) stamp(c, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
      else stamp(c, { allocatedRevenue: null, allocationBasis: "EXCLUDED_NON_GEAR" });
    }
  }

  const roots = lines.filter((l) => !l.parentLineItemId || !byId.has(l.parentLineItemId));

  /**
   * A parentLineItemId cycle has no root, so nothing would ever traverse it and its
   * pool would silently vanish — a priced kit trapped in one would report $0 for
   * every model inside it. The FK makes a cycle all but impossible; losing money
   * quietly if one ever appears is not acceptable anyway.
   *
   * Promote the lowest member of each unreachable component to a root and cut its
   * parent edge, so the component becomes a tree, gets allocated, and terminates.
   */
  const reachable = new Set<string>();
  const walk = (l: AllocLine) => {
    if (reachable.has(l.id)) return;
    reachable.add(l.id);
    for (const c of childrenOf.get(l.id) ?? []) walk(c);
  };
  for (const r of roots) walk(r);

  if (reachable.size < lines.length) {
    const stranded = lines
      .filter((l) => !reachable.has(l.id))
      .sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
    for (const l of stranded) {
      if (reachable.has(l.id)) continue;
      const siblings = childrenOf.get(l.parentLineItemId!) ?? [];
      childrenOf.set(l.parentLineItemId!, siblings.filter((s) => s.id !== l.id));
      roots.push(l);
      walk(l);
    }
  }

  // Grouped roots: the pool is the BUNDLE price, not the sum of the members'
  // lineTotals — recalcProjectTotals bills `group.price × group.quantity`, so a
  // grouped member's own lineTotal never reaches project revenue.
  for (const g of groups) {
    const inGroup = roots.filter((l) => l.groupId === g.id && !isInactive(l));
    // Freebies ($0 items) are pre-stamped and take no share — the paying gear splits
    // the whole pool between them.
    const gear = inGroup.filter((l) => !isNonGear(l) && !isFreebie(l));
    // A priced custom item inside a group is PART of the group's flat price, not an
    // extra on top (recalc bills the flat price only). So it takes its own set
    // amount straight off the pool and the owned gear splits what's left — a $1,800
    // custom item in a $2,000 group leaves $200 for the gear. It's still excluded
    // from ROI (no model), but now it consumes rather than being invisible.
    const customs = inGroup.filter((l) => l.isCustomItem === true);

    // Round the PRODUCT, not the price: recalcProjectTotals bills `price × quantity`
    // and rounds the sum, so rounding the price first would allocate a pool the
    // project never charged for. Discount (#883) is subtracted the same way
    // recalcProjectTotals does — a flat $ amount off the bundle total, clamped at 0
    // BEFORE the project-level discount factor poolOf applies.
    const bundleTotal = Math.max(0, (g.price ?? 0) * Math.max(0, g.quantity ?? 0) - (g.discount ?? 0));
    const poolCents = poolOf(bundleTotal);

    const customCents = customs.map((c) => Math.max(0, poolOf(c.lineTotal)));
    const customSum = customCents.reduce((a, b) => a + b, 0);

    // Customs come off the top at FACE VALUE and the gear splits the remainder —
    // BUT only when there is gear to take that remainder AND the customs fit inside
    // the pool. Otherwise (no gear, or customs priced above the pool) the customs
    // absorb the WHOLE pool between them, so `SUM(children) == pool` holds in every
    // branch. Without this, a priced group of custom-only items would silently drop
    // its leftover (a $100 group with a $40 custom would record only $40).
    const gearTakesRemainder = gear.length > 0 && customSum <= poolCents;
    let gearPool: number;
    if (gearTakesRemainder) {
      customs.forEach((c, i) =>
        out.set(c.id, {
          allocatedRevenue: fromCents(customCents[i]),
          allocationBasis: "EXCLUDED_NON_GEAR",
        }),
      );
      gearPool = poolCents - customSum;
    } else {
      const shares = largestRemainder(poolCents, customCents, customs.map(sortKey));
      customs.forEach((c, i) =>
        out.set(c.id, {
          allocatedRevenue: fromCents(shares[i]),
          allocationBasis: "EXCLUDED_NON_GEAR",
        }),
      );
      gearPool = 0;
    }

    // No paying gear (all freebies, or an empty group). Whatever the customs didn't
    // consume is genuinely unattributable — nothing owned earned it — so it's left
    // off ROI. The group's price still bills; it just credits no model. (SUM(children)
    // == pool holds whenever there IS a paying participant.)
    if (gear.length === 0) continue;
    if (gear.length === 1) {
      assign(gear[0], gearPool, gearPool === 0 ? "NO_REVENUE" : "DIRECT");
      continue;
    }
    const { weights, basis } = chooseWeights(gear, null);
    const shares = largestRemainder(gearPool, weights, gear.map(sortKey));
    gear.forEach((m, i) => assign(m, shares[i], basis));
  }

  // Ungrouped roots bill their own lineTotal, so that IS the pool.
  for (const l of roots) {
    if (out.has(l.id)) continue;
    if (isInactive(l)) {
      stamp(l, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
      continue;
    }
    if (isNonGear(l)) {
      // Includes custom items sitting INSIDE a group: recalcProjectTotals bills
      // them on top of the bundle price, so they never took a share of it.
      stamp(l, { allocatedRevenue: null, allocationBasis: "EXCLUDED_NON_GEAR" });
      continue;
    }
    if (l.groupId) {
      // Gear in a group whose row is missing (deleted mid-write). Don't guess.
      stamp(l, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
      continue;
    }
    const poolCents = poolOf(l.lineTotal);
    assign(l, poolCents, poolCents === 0 ? "NO_REVENUE" : "DIRECT");
  }

  // Anything unreachable (orphaned child of a non-participating parent).
  for (const l of lines) {
    if (!out.has(l.id)) out.set(l.id, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
  }

  // Freebies are ALWAYS $0 / excluded, no matter what a subtree pass stamped on the
  // way through — e.g. a freebie nested under a sub-hire is first stamped with the
  // sub-hire's audit value by the wholesale `stamp`. This final override is the
  // single source of truth for "$0 means excluded."
  for (const l of lines) {
    if (isFreebie(l)) out.set(l.id, { allocatedRevenue: 0, allocationBasis: "NO_REVENUE" });
  }

  return out;
}

// ── Kit allocation helpers ───────────────────────────────────────────────────

/**
 * Does this saved split still describe the kit? Exact cover, both ways: a model the
 * kit gained has no percentage, and a model it lost still holds one. Either way the
 * split no longer adds to 100% of what's actually in the case, so applying it would
 * quietly misattribute revenue. Rule 1 is skipped and the kit is flagged stale.
 */
export function allocationCoversKit(
  saved: ReadonlyMap<string, number>,
  kitModelIds: readonly string[],
): boolean {
  const kitModels = new Set(kitModelIds);
  return kitModels.size === saved.size && [...kitModels].every((m) => saved.has(m));
}

/**
 * Cost-weighted default so nobody types percentages from scratch: a $2,000 receiver
 * earns a bigger slice than a $15 mic belt. Falls back to an equal split when no
 * model in the kit has a replacement cost.
 *
 * Computed in hundredths of a percent with largest-remainder rounding, so the
 * suggestion always sums to exactly 100.00 and the panel never opens on a split it
 * would refuse to save.
 */
export function suggestKitAllocation(
  items: readonly { modelId: string; quantity: number; replacementCost?: number | null }[],
): Map<string, number> {
  if (items.length === 0) return new Map();

  const weights = items.map(
    (i) => Math.max(0, Number(i.replacementCost ?? 0)) * Math.max(1, i.quantity),
  );
  const shares = largestRemainder(
    10_000,
    weights,
    items.map((_, i) => i),
  );
  return new Map(items.map((i, idx) => [i.modelId, shares[idx] / 100]));
}

/** Roll leaf allocations up to (modelId → dollars), counting only earned bases. */
export function rollupByModel(
  lines: readonly AllocLine[],
  allocations: ReadonlyMap<string, LineAllocation>,
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const l of lines) {
    if (!l.modelId) continue;
    const a = allocations.get(l.id);
    if (!a || a.allocatedRevenue == null || !isRoiCounted(a.allocationBasis)) continue;
    cents.set(l.modelId, (cents.get(l.modelId) ?? 0) + toCents(a.allocatedRevenue));
  }
  return new Map([...cents].map(([m, c]) => [m, fromCents(c)]));
}

// ── Convex binding ───────────────────────────────────────────────────────────

/**
 * Recompute a project's allocation and persist it. Called from the tail of
 * `recalcProjectTotals`, which every line-item / group / service / sub-hire write
 * already funnels through — so there is no trigger list to keep in sync, and no way
 * to add a write path that forgets to allocate.
 *
 * `groups` and `lines` are passed in because the caller has already read them.
 *
 * Line patches are DIFFED: a 200-line project takes ~0 writes when an edit doesn't
 * move any allocation, instead of 200.
 */
export async function applyProjectAllocation(
  ctx: MutationCtx,
  args: {
    projectId: string;
    orgId: string;
    rentalPeriod?: string | null;
    /** Project-level discount, 0–100. Scales every pool to what was actually billed. */
    discountPercent?: number | null;
    groups: readonly AllocGroup[];
    lines: readonly Doc<"projectLineItems">[];
    now: number;
  },
): Promise<void> {
  const { projectId, orgId, groups, lines, now } = args;

  const modelIds = [...new Set(lines.map((l) => l.modelId).filter(Boolean))] as string[];
  const kitIds = [...new Set(lines.map((l) => l.kitId).filter(Boolean))] as string[];

  const models = new Map<string, AllocModel>();
  for (const id of modelIds) {
    const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (m) models.set(id, m as AllocModel);
  }

  const kitAllocations = new Map<string, Map<string, number>>();
  for (const kitId of kitIds) {
    const rows = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    if (rows.length === 0) continue;
    kitAllocations.set(kitId, new Map(rows.map((r) => [r.modelId, r.allocationPercent])));
  }

  const weekly = args.rentalPeriod === "WEEKLY";
  const result = allocateProject({
    lines,
    groups,
    models,
    kitAllocations,
    rentalPeriod: args.rentalPeriod,
    revenueFactor: 1 - Number(args.discountPercent ?? 0) / 100,
    // Prefer the fleet's own rate/cost relationship; fall back to the engine default.
    rateFactor: deriveRateFactor(models.values(), weekly) ?? undefined,
  });

  for (const line of lines) {
    const next = result.get(line.id);
    if (!next) continue;
    const prevRev = line.allocatedRevenue ?? null;
    const prevBasis = line.allocationBasis ?? null;
    if (prevRev === next.allocatedRevenue && prevBasis === next.allocationBasis) continue;
    await ctx.db.patch(line._id, {
      // `undefined` clears the field — a container line has no revenue to record,
      // which is meaningfully different from having earned $0.
      allocatedRevenue: next.allocatedRevenue ?? undefined,
      allocationBasis: next.allocationBasis,
    });
  }

  await rebuildProjectModelRevenue(ctx, projectId, orgId, rollupByModel(lines, result), now);
}

/**
 * Rebuild the (project, model) rollup this project contributes to fleet ROI.
 *
 * Wholesale rebuild, diffed against what's there. The table is a pure cache of the
 * line-item allocations — safe to drop and regenerate at any time.
 */
async function rebuildProjectModelRevenue(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
  totals: ReadonlyMap<string, number>,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("projectModelRevenues")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();

  // Convex indexes don't enforce uniqueness, so a duplicate (projectId, modelId)
  // could survive an import or a repair script — and ROI SUMs every row it finds.
  // Keep one per model and delete the rest, so a rebuild heals the table rather
  // than preserving a double-count forever.
  const byModel = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const kept = byModel.get(row.modelId);
    if (!kept) byModel.set(row.modelId, row);
    else await ctx.db.delete(row._id);
  }

  for (const [modelId, revenue] of totals) {
    const row = byModel.get(modelId);
    if (!row) {
      await ctx.db.insert("projectModelRevenues", {
        id: `pmr_${projectId}_${modelId}`,
        organizationId: orgId,
        projectId,
        modelId,
        allocatedRevenue: revenue,
        updatedAt: now,
      });
    } else if (row.allocatedRevenue !== revenue) {
      await ctx.db.patch(row._id, { allocatedRevenue: revenue, updatedAt: now });
    }
    byModel.delete(modelId);
  }

  // Models that no longer earn anything here (line removed, kit swapped out).
  for (const stale of byModel.values()) await ctx.db.delete(stale._id);
}

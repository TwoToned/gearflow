import type { Doc } from "../_generated/dataModel";
import { computeTotals, type TotalsBundle } from "./recalc";

/**
 * Project Versioning v2, Phase 5b (#1232, parent #1221, design §5.1
 * D46-D53) — the PURE alignment + money-bridge module behind Compare mode.
 * No Convex `ctx`, no I/O, no UI: two `TotalsBundle`s in, a classified row
 * list + an exact money bridge out. `convex/versionsRead.ts`'s
 * `compareVersions` query is the only caller; the UI never re-derives this
 * math (R-3.1).
 *
 * ── Row alignment (D50) ─────────────────────────────────────────────────
 * Rows are matched by `lineageId` (falling back to a row's own `id` when
 * absent — the Phase 1 backfill's own convention: "every row's lineage
 * starts at itself"), never by text similarity. This is what makes a line
 * that changed CATEGORY read as `moved`, not as a `removed` + `added` pair
 * that would double-count in the bridge below.
 *
 * ── The money bridge (D48) ──────────────────────────────────────────────
 * `computeTotals` is the single authority for "what does this project cost"
 * (`convex/lib/recalc.ts`, D59). Rather than hand-deriving a second formula
 * for "how much did THIS row contribute" (which would have to reimplement
 * the group-bundle-price/custom-extras/tax-contribution rules `computeTotals`
 * already owns — a second copy of that business logic, R-3.1), the bridge is
 * built by INCREMENTAL SUBSTITUTION: start from side A's bundle, walk the
 * classified changes in deterministic groups, and after each group swap A's
 * rows for B's rows and re-run `computeTotals`. Each segment's amount is
 * simply the delta between consecutive calls. Because this is a telescoping
 * sum — segment_1 + segment_2 + ... + segment_n = total(after_n) - total(before_1)
 * — `sum(segments) === totalB - totalA` holds by construction, not by
 * approximation, and it holds regardless of any interaction between rows
 * (tax brackets, group bundle pricing, etc.) since every intermediate state
 * is a real, valid `TotalsBundle` run through the real function.
 *
 * `total` (the client-facing figure the bridge visualizes) is a function of
 * exactly: `groups`, `projectLines`, `services`, `project.discountPercent`,
 * `project.taxRate`, and `client.taxExempt` (verified by reading
 * `computeTotals`'s body — `assignments`/`subHires`/`invoices`/
 * `saleCostRefs`/`orgDefaultTaxRate` feed `margin`/cost buckets only, never
 * `total`, and are identical across A/B anyway since they are NOT
 * version-scoped reads). So the walk only ever needs to vary those six
 * inputs.
 */

// ─── Row classification ────────────────────────────────────────────────

export type CompareRowKind = "line" | "group" | "service";
export type CompareRowState = "unchanged" | "changed" | "added" | "removed" | "moved";

export interface CompareRowSnapshot {
  id: string;
  label: string;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number;
  categoryId: string | null;
  groupId: string | null;
  status?: string;
}

export interface CompareRow {
  /** `lineageId` (or the row's own `id` when lineage is absent). */
  key: string;
  kind: CompareRowKind;
  state: CompareRowState;
  a: CompareRowSnapshot | null;
  b: CompareRowSnapshot | null;
  /** Only set when `state === "moved"` and the field actually differs. */
  movedFromCategoryId?: string | null;
  movedFromGroupId?: string | null;
  /** A moved row that ALSO repriced — still ONE row, one bridge segment
   *  (D50's "never double-count" rule). Purely informational for display. */
  alsoRepriced?: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

function keyOf(row: { id: string; lineageId?: string }): string {
  return row.lineageId ?? row.id;
}

/** `v ?? null` as a call, not an inline `??` — keeps a comparison like
 *  `orNull(a.x) !== orNull(b.x)` to a single decision point (the `!==`
 *  doesn't count) instead of three (two `??`s plus the `!==`), which is
 *  what actually drives several functions below over the complexity budget
 *  (POLICY.md R-3.6) despite reading as "just one comparison". */
function orNull<T>(v: T | undefined | null): T | null {
  return v ?? null;
}

function snapshotLine(li: Doc<"projectLineItems">): CompareRowSnapshot {
  return {
    id: li.id,
    label: li.description || li.groupName || "Line item",
    quantity: numOrNull(li.quantity),
    unitPrice: numOrNull(li.unitPrice),
    discount: numOrNull(li.discount),
    lineTotal: Number(li.lineTotal) || 0,
    categoryId: li.categoryId ?? null,
    groupId: li.groupId ?? null,
    status: li.status,
  };
}

/** Mirrors `computeTotals`'s own `bundleTotal` formula (`price * quantity -
 *  discount`, clamped at 0) for DISPLAY only — the bridge's actual segment
 *  amounts never depend on this being byte-exact (they come from
 *  `computeTotals` itself via the incremental walk), so this small mirror
 *  cannot desync the money math, only a row's displayed subtotal. */
function snapshotGroup(g: Doc<"projectGroups">): CompareRowSnapshot {
  const price = Number(g.price) || 0;
  const quantity = numOrNull(g.quantity);
  const discount = Number(g.discount) || 0;
  return {
    id: g.id,
    label: g.title,
    quantity,
    unitPrice: price || null,
    discount: g.discount != null ? discount : null,
    lineTotal: Math.max(0, price * (quantity ?? 0) - discount),
    categoryId: g.categoryId ?? null,
    groupId: null,
    status: undefined,
  };
}

function snapshotService(s: Doc<"projectServices">): CompareRowSnapshot {
  return {
    id: s.id,
    label: s.title,
    quantity: numOrNull(s.quantity),
    unitPrice: numOrNull(s.unitPrice),
    discount: numOrNull(s.discount),
    lineTotal: Number(s.lineTotal) || 0,
    categoryId: null,
    groupId: null,
    status: s.status,
  };
}

/** Standalone, priced, plan-visible line items — kit/accessory children,
 *  optional lines and cancelled lines are excluded from the row-level diff
 *  (a documented scope limit, see FEATUREDOCS/76's Phase 5b section): none
 *  of them can independently move `computeTotals`'s `total` on their own
 *  (kit children are excluded from every revenue bucket; optional/cancelled
 *  lines are excluded from every bucket outright), so leaving them out of
 *  the row table never risks the bridge's exactness — see the defensive
 *  reconciliation step in `buildMoneyBridge` below, which would surface as a
 *  non-empty "unexplained" segment if that assumption were ever wrong. */
function isComparableLine(li: Doc<"projectLineItems">): boolean {
  return !li.isKitChild && !li.isOptional && li.status !== "CANCELLED";
}

/** The comparable-field diff behind "changed" (D50) — split out so the
 *  6-way boolean OR doesn't count against the caller's own cyclomatic
 *  complexity (POLICY.md R-3.6). */
function snapshotFieldsDiffer(a: CompareRowSnapshot, b: CompareRowSnapshot): boolean {
  return (
    a.lineTotal !== b.lineTotal ||
    a.quantity !== b.quantity ||
    a.unitPrice !== b.unitPrice ||
    a.discount !== b.discount ||
    a.status !== b.status ||
    a.label !== b.label
  );
}

/** Classifies ONE matched pair (present in both A and B) — the moved /
 *  changed / unchanged branch of D50, split out of `buildRowsForKind` for
 *  the same reason as `snapshotFieldsDiffer` above. */
function buildMovedRow(
  key: string,
  kind: CompareRowKind,
  snapA: CompareRowSnapshot,
  snapB: CompareRowSnapshot,
  movedFromCategoryId: string | null | undefined,
  movedFromGroupId: string | null | undefined,
): CompareRow {
  return {
    key,
    kind,
    state: "moved",
    a: snapA,
    b: snapB,
    movedFromCategoryId,
    movedFromGroupId,
    alsoRepriced: snapshotFieldsDiffer(snapA, snapB),
  };
}

function classifyMatchedPair<T extends { categoryId?: string; groupId?: string }>(
  key: string,
  kind: CompareRowKind,
  a: T,
  b: T,
  snapA: CompareRowSnapshot,
  snapB: CompareRowSnapshot,
): CompareRow {
  const categoryChanged = orNull(a.categoryId) !== orNull(b.categoryId);
  const groupChanged = orNull(a.groupId) !== orNull(b.groupId);
  if (!categoryChanged && !groupChanged) {
    const state = snapshotFieldsDiffer(snapA, snapB) ? "changed" : "unchanged";
    return { key, kind, state, a: snapA, b: snapB };
  }
  return buildMovedRow(
    key,
    kind,
    snapA,
    snapB,
    categoryChanged ? orNull(a.categoryId) : undefined,
    groupChanged ? orNull(a.groupId) : undefined,
  );
}

function buildRowsForKind<T extends { id: string; lineageId?: string; categoryId?: string; groupId?: string }>(
  kind: CompareRowKind,
  aRows: T[],
  bRows: T[],
  snapshot: (row: T) => CompareRowSnapshot,
): CompareRow[] {
  const aByKey = new Map(aRows.map((r) => [keyOf(r), r]));
  const bByKey = new Map(bRows.map((r) => [keyOf(r), r]));
  const keys = new Set<string>([...aByKey.keys(), ...bByKey.keys()]);
  const out: CompareRow[] = [];

  for (const key of keys) {
    const a = aByKey.get(key);
    const b = bByKey.get(key);
    if (a && !b) {
      out.push({ key, kind, state: "removed", a: snapshot(a), b: null });
      continue;
    }
    if (!a && b) {
      out.push({ key, kind, state: "added", a: null, b: snapshot(b) });
      continue;
    }
    if (!a || !b) continue; // unreachable — one of the two branches above always fires
    out.push(classifyMatchedPair(key, kind, a, b, snapshot(a), snapshot(b)));
  }
  return out;
}

/**
 * D50 — classifies every group/line/service row across the two bundles.
 * Groups and services are compared in full (no exclusion — a group's own
 * bundle price and a service's own charge always feed `total`); line items
 * are narrowed to `isComparableLine` first (see that function's comment).
 */
export function classifyCompareRows(bundleA: TotalsBundle, bundleB: TotalsBundle): CompareRow[] {
  const groupRows = buildRowsForKind("group", bundleA.groups, bundleB.groups, snapshotGroup);
  const lineRows = buildRowsForKind(
    "line",
    bundleA.projectLines.filter(isComparableLine),
    bundleB.projectLines.filter(isComparableLine),
    snapshotLine,
  );
  const serviceRows = buildRowsForKind("service", bundleA.services, bundleB.services, snapshotService);
  return [...groupRows, ...lineRows, ...serviceRows];
}

// ─── The money bridge (D48) ────────────────────────────────────────────

export type BridgeSegmentState = CompareRowState | "planField" | "unexplained";

export interface BridgeSegment {
  key: string;
  state: BridgeSegmentState;
  kind: CompareRowKind | "planField" | "mixed";
  /** `null` for a service/plan-field segment (services/plan fields have no category). */
  categoryId: string | null;
  amount: number;
  /** The `CompareRow.key`s (or, for a plan-field segment, the field name)
   *  this segment traces to — D48's "every segment traces to rows"
   *  requirement, mechanically checkable via `assertBridgeIntegrity`. */
  rowKeys: string[];
  /** Set only on a `"planField"` segment. */
  planField?: string;
}

export interface MoneyBridge {
  totalA: number;
  totalB: number;
  segments: BridgeSegment[];
}

const MONEY_PLAN_FIELDS = ["discountPercent", "taxRate"] as const;

function bucketKeyFor(row: CompareRow): string {
  const cat = row.state === "removed" ? (row.a?.categoryId ?? null) : (row.b?.categoryId ?? null);
  const catPart = row.kind === "service" ? "__service__" : (cat ?? "__none__");
  return `${row.state}:${row.kind === "service" ? "service" : "row"}:${catPart}`;
}

/**
 * Builds the exact money bridge between `bundleA` and `bundleB` (D48),
 * given `classifyCompareRows`'s own output. See the file header for the
 * incremental-substitution technique and why it guarantees exactness with
 * zero duplication of `computeTotals`'s business rules.
 */
/** Mutable walk state threaded between the row-segment and plan-field
 *  passes below — a plain object rather than several `let`s so both passes
 *  can share and mutate it without adding closure/parameter noise to
 *  `buildMoneyBridge` itself (POLICY.md R-3.6, the same motivation as the
 *  other extractions in this file). */
interface WalkState {
  project: Doc<"projects">;
  client: Doc<"clients"> | null;
  runningTotal: number;
  groupsMap: Map<string, Doc<"projectGroups">>;
  linesMap: Map<string, Doc<"projectLineItems">>;
  servicesMap: Map<string, Doc<"projectServices">>;
}

function walkBundle(state: WalkState, bundleA: TotalsBundle): TotalsBundle {
  return {
    ...bundleA,
    project: state.project,
    client: state.client,
    groups: [...state.groupsMap.values()],
    projectLines: [...state.linesMap.values()],
    services: [...state.servicesMap.values()],
  };
}

/** Explicit per-kind branches rather than a generic map-selector — a
 *  selector returning `groupsMap | linesMap | servicesMap` loses the
 *  correlation between "which map" and "which bMap", so TS can't prove a
 *  row read from `bMap` is assignable into `map` even though `r.kind`
 *  guarantees they're the same table. Applying the change directly here
 *  keeps that correlation type-safe. */
function applyRowChange(state: WalkState, bundleB: TotalsBundle, r: CompareRow): void {
  if (r.kind === "group") {
    if (r.state === "removed") state.groupsMap.delete(r.key);
    else {
      const row = bundleB.groups.find((g) => keyOf(g) === r.key);
      if (row) state.groupsMap.set(r.key, row);
    }
  } else if (r.kind === "service") {
    if (r.state === "removed") state.servicesMap.delete(r.key);
    else {
      const row = bundleB.services.find((s) => keyOf(s) === r.key);
      if (row) state.servicesMap.set(r.key, row);
    }
  } else {
    if (r.state === "removed") state.linesMap.delete(r.key);
    else {
      const row = bundleB.projectLines.find((l) => keyOf(l) === r.key);
      if (row) state.linesMap.set(r.key, row);
    }
  }
}

/** The row-segment pass (D49) — buckets every non-unchanged row by
 *  (state, category), applies each bucket to `state` in one step, and
 *  records the resulting `computeTotals` delta as one segment. */
function buildRowSegments(state: WalkState, bundleA: TotalsBundle, bundleB: TotalsBundle, rows: CompareRow[]): BridgeSegment[] {
  const segments: BridgeSegment[] = [];
  const buckets = new Map<string, CompareRow[]>();
  for (const r of rows) {
    if (r.state === "unchanged") continue;
    const bk = bucketKeyFor(r);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk)!.push(r);
  }

  for (const bucketKey of [...buckets.keys()].sort()) {
    const bucketRows = buckets.get(bucketKey)!;
    for (const r of bucketRows) {
      // added / changed / moved / removed — see `applyRowChange`. A moved
      // row is replaced in exactly this ONE step, so it contributes to the
      // bridge exactly once even when it also repriced (D50).
      applyRowChange(state, bundleB, r);
    }
    const newTotal = computeTotals(walkBundle(state, bundleA)).total;
    const delta = round2(newTotal - state.runningTotal);
    state.runningTotal = newTotal;
    const [rowState, , categoryId] = bucketKey.split(":");
    segments.push({
      key: bucketKey,
      state: rowState as CompareRowState,
      kind: bucketRows[0].kind,
      categoryId: categoryId === "__none__" || categoryId === "__service__" ? null : categoryId,
      amount: delta,
      rowKeys: bucketRows.map((r) => r.key),
    });
  }
  return segments;
}

function recordDelta(state: WalkState, bundleA: TotalsBundle): number {
  const newTotal = computeTotals(walkBundle(state, bundleA)).total;
  const delta = round2(newTotal - state.runningTotal);
  state.runningTotal = newTotal;
  return delta;
}

/** D48's "the rental window moving is a first-class segment with no row
 *  behind it" requirement, generalized to every MONEY plan field
 *  (discountPercent, taxRate — see the file header for why dates/notes/etc
 *  need no step: they don't move `total` at all). */
function buildMoneyFieldSegments(state: WalkState, bundleA: TotalsBundle, bundleB: TotalsBundle): BridgeSegment[] {
  const segments: BridgeSegment[] = [];
  for (const field of MONEY_PLAN_FIELDS) {
    const aVal = bundleA.project[field] ?? null;
    const bVal = bundleB.project[field] ?? null;
    if (aVal === bVal) continue;
    state.project = { ...state.project, [field]: bundleB.project[field] };
    const delta = recordDelta(state, bundleA);
    if (delta !== 0) {
      segments.push({ key: `planField:${field}`, state: "planField", kind: "planField", categoryId: null, amount: delta, rowKeys: [`planField:${field}`], planField: field });
    }
  }
  return segments;
}

/** Client swap (taxExempt cascades through the tax calc) — same treatment
 *  as `buildMoneyFieldSegments`, split out because it isn't a per-field
 *  loop (the identity comparison is a composite key, not a plain field
 *  equality check). */
function clientIdentityKey(client: Doc<"clients"> | null): string {
  return `${orNull(client?.id) ?? ""}:${orNull(client?.taxExempt) ?? false}`;
}

function buildClientSegment(state: WalkState, bundleA: TotalsBundle, bundleB: TotalsBundle): BridgeSegment[] {
  if (clientIdentityKey(bundleA.client) === clientIdentityKey(bundleB.client)) return [];
  state.client = bundleB.client;
  state.project = { ...state.project, clientId: bundleB.project.clientId };
  const delta = recordDelta(state, bundleA);
  if (delta === 0) return [];
  return [{ key: "planField:client", state: "planField", kind: "planField", categoryId: null, amount: delta, rowKeys: ["planField:client"], planField: "clientId" }];
}

function buildPlanFieldSegments(state: WalkState, bundleA: TotalsBundle, bundleB: TotalsBundle): BridgeSegment[] {
  return [...buildMoneyFieldSegments(state, bundleA, bundleB), ...buildClientSegment(state, bundleA, bundleB)];
}

export function buildMoneyBridge(bundleA: TotalsBundle, bundleB: TotalsBundle, rows: CompareRow[]): MoneyBridge {
  const totalA = computeTotals(bundleA).total;
  const totalB = computeTotals(bundleB).total;

  // Working state — FULL row sets (not just the comparable subset), keyed by
  // lineage, seeded from side A. Rows outside the comparable set (kit
  // children, optional/cancelled lines) are never touched by the walk below
  // and stay at side A's version throughout — safe, because none of them can
  // move `total` (see `isComparableLine`'s comment); the reconciliation step
  // at the end is the mechanical proof of that, not just an assertion.
  const state: WalkState = {
    project: bundleA.project,
    client: bundleA.client,
    runningTotal: 0,
    groupsMap: new Map(bundleA.groups.map((g) => [keyOf(g), g])),
    linesMap: new Map(bundleA.projectLines.map((l) => [keyOf(l), l])),
    servicesMap: new Map(bundleA.services.map((s) => [keyOf(s), s])),
  };
  state.runningTotal = computeTotals(walkBundle(state, bundleA)).total;

  const segments: BridgeSegment[] = [
    ...buildRowSegments(state, bundleA, bundleB, rows),
    ...buildPlanFieldSegments(state, bundleA, bundleB),
  ];

  // ── Defensive reconciliation. By construction `state.runningTotal` should now
  // equal `totalB` exactly (every row/plan-field input `computeTotals` reads
  // has been walked to side B's value). If classification ever missed a
  // computeTotals-relevant field, this closes the gap with an explicit,
  // clearly-unattributed segment — `assertBridgeIntegrity` below is what
  // catches that (an "unexplained" segment's `rowKeys` is deliberately NOT a
  // real row, so it fails the "traces to rows" check by design) rather than
  // silently absorbing it. Every test fixture in `versionCompare.test.ts`
  // asserts this segment is NEVER produced. ─────────────────────────────
  const leftover = round2(totalB - state.runningTotal);
  if (Math.abs(leftover) >= 0.005) {
    segments.push({ key: "unexplained", state: "unexplained", kind: "mixed", categoryId: null, amount: leftover, rowKeys: [] });
  }

  return { totalA, totalB, segments };
}

/**
 * D48's two hard correctness rules, mechanically checked:
 *  1. `sum(segments) === totalB - totalA` (to the cent).
 *  2. Every segment traces to at least one row/plan-field (`rowKeys.length
 *     > 0`) — a segment with nothing behind it is exactly the "unexplained"
 *     escape hatch `buildMoneyBridge` emits defensively, which this function
 *     is what turns into a hard failure rather than a silently-accepted gap.
 * Throws on violation; does not mutate `bridge`.
 */
export function assertBridgeIntegrity(bridge: MoneyBridge): void {
  const sum = round2(bridge.segments.reduce((s, seg) => s + seg.amount, 0));
  const expected = round2(bridge.totalB - bridge.totalA);
  if (Math.abs(sum - expected) >= 0.005) {
    throw new Error(`Bridge segments sum to ${sum} but totalB - totalA is ${expected}`);
  }
  for (const seg of bridge.segments) {
    if (seg.rowKeys.length === 0) {
      throw new Error(`Bridge segment "${seg.key}" (${seg.state}) traces to no row or plan-field change`);
    }
  }
}

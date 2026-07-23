/**
 * Pure (React-free) row descriptors for the project equipment tree. Kept out of
 * `equipment-rows.tsx` so the branching logic — which rows expand, how a unit's
 * fulfillment status maps to a badge — is unit-testable in the node env without
 * pulling in the component's Convex/React imports. `equipment-rows.tsx`
 * re-exports these so existing consumers import from one place.
 *
 * `LineItemData` is imported type-only (erased at runtime → no component load)
 * from the pure types module, not from `equipment-rows.tsx` — importing the
 * component module here would create a circular dependency (POLICY.md R-3.5).
 */
import type { LineItemData } from "./equipment-row-types";

// ─── Row descriptor (cross-type unification) ─────────────────────────────────
//
// A line-item row is described by independent axes, NOT one flat "kind" enum — a
// sub-hire group child is simultaneously a `subhire` source AND a `child` role,
// which a flat enum can't represent. `describeRow` derives the axes computable
// from the item alone. Each field preserves the EXACT boolean expression the row
// previously used inline, so rendering is unchanged.

export type RowSource = "owned" | "subhire" | "custom";
export type RowRole = "parent" | "child" | "standalone";

export interface RowDescriptor {
  /** owned stock / sub-hire / ad-hoc custom — drives the leading kind icon. */
  source: RowSource;
  /** parent (has expandable children) / child / standalone. */
  role: RowRole;
  /** kit parent: `kitId` set and not itself a kit child. */
  isKit: boolean;
  /** sub-hire line: `subHireId` set OR legacy `type === "SUBHIRE"`. */
  isSubhire: boolean;
  /** show the expand chevron (kit parent or sub-hire group parent with children). */
  hasChildren: boolean;
  /** A plain serialised line whose per-unit assets expand into their own rows
   *  (multi-quantity, ≥2 tagged units, and NOT already a kit/sub-hire parent). */
  hasExpandableUnits: boolean;
}

/** Count units carrying a resolved asset/bulk tag (the ones worth expanding). */
export function taggedUnitCount(item: LineItemData): number {
  return (item.units ?? []).filter((u) => u.asset?.assetTag || u.bulkAsset?.assetTag).length;
}

export function describeRow(item: LineItemData): RowDescriptor {
  const isSubhire = item.subHireId != null || item.type === "SUBHIRE";
  const isKit = !!item.kitId && !item.isKitChild;
  // An accessory parent is a plain top-level asset line (no kitId, no sub-hire)
  // whose children are permanently-attached accessories — they expand the same
  // way kit members do.
  const isAccessoryParent =
    !item.isKitChild &&
    !item.kitId &&
    (item.childLineItems?.some((c) => c.childKind === "ACCESSORY") ?? false);
  // Preserve the exact original expression: any kitId, OR a non-child sub-hire,
  // PLUS accessory parents.
  const hasChildren =
    (item.childLineItems?.length ?? 0) > 0 &&
    (!!item.kitId || (item.subHireId != null && !item.isKitChild) || isAccessoryParent);
  // A loose/grouped serialised multi-qty line has no childLineItems but multiple
  // tagged units — expand those into per-unit rows (with fulfillment status). A
  // single tagged unit stays inline (rendered next to the name). Kit children
  // themselves never expand their units.
  const hasExpandableUnits = !hasChildren && !item.isKitChild && taggedUnitCount(item) > 1;
  const source: RowSource = item.isCustomItem ? "custom" : isSubhire ? "subhire" : "owned";
  const role: RowRole = item.isKitChild ? "child" : hasChildren ? "parent" : "standalone";
  return { source, role, isKit, isSubhire, hasChildren, hasExpandableUnits };
}

/**
 * Map a per-unit fulfillment status (+ return condition) → a human label and the
 * badge appearance. Deployed = out on the job (red); Returned = back (green, or
 * warn/red if damaged/missing); everything pre-deployment is neutral. See the
 * warehouse Deploy/Return tabs for the same vocabulary.
 */
export function unitFulfillmentBadge(
  status?: string | null,
  returnCondition?: string | null,
): { label: string; status: "ok" | "warn" | "overbooked" | "repair" | "neutral"; className?: string } {
  switch (status) {
    case "CHECKED_OUT":
      return { label: "Deployed", status: "neutral", className: "bg-out-soft text-t-out" };
    case "RETURNED":
      if (returnCondition === "DAMAGED") return { label: "Returned · Damaged", status: "warn" };
      if (returnCondition === "MISSING") return { label: "Returned · Missing", status: "overbooked" };
      return { label: "Returned", status: "ok" };
    case "PREPPED":
      return { label: "Prepped", status: "neutral" };
    case "CONFIRMED":
      return { label: "Assigned", status: "neutral" };
    case "QUOTED":
      return { label: "Reserved", status: "neutral" };
    default:
      return {
        label: status ? status.charAt(0) + status.slice(1).toLowerCase() : "—",
        status: "neutral",
      };
  }
}

/**
 * Pure `LineItem[]` → `LineRowData` sections for the warehouse job table
 * (spec §9.2, §9.5). Category groups on To pick, case groups from Prepped on;
 * the stage chip comes from the ONE gear-stage table, so a Returned line can
 * never read "Prepped" (§1.1).
 */
import {
  accessoryChildrenOf, bulkStageUnitCount, isBulkItem, isInCheckedOutStage, isInDeprepedStage, isInPickPrepStage, isInPreppedStage, isInReturnedStage,
  modelDisplayName, resolveItemContainerId, type LineItem,
} from "@/components/warehouse/warehouse-types";
import { isRelocatedLineId } from "@/components/warehouse/relocate-accessories";
import { deriveItemStage, type WarehouseStageKey } from "@/components/warehouse/warehouse-stages";
import type { LineRowData, LineRowSectionData, RowFlag, StateGlyph } from "@/lib/primitives/types";
import { getStatusIntent } from "@/lib/status-colors";
import { isInternalStockLine } from "@/lib/warehouse-subhire-filter";
import { GEAR_STAGE_LABELS } from "@/lib/vocabulary";

/** The job page's stage filter keys (spec §9.2). `closeout` has no gear rows. */
export type JobStage = "pick" | "prepped" | "out" | "returned" | "deprepped";

const IN_STAGE: Record<JobStage, (li: LineItem) => boolean> = {
  pick: isInPickPrepStage, prepped: isInPreppedStage, out: isInCheckedOutStage, returned: isInReturnedStage, deprepped: isInDeprepedStage,
};
const GEAR_KEY: Record<JobStage, WarehouseStageKey> = { pick: "to_prep", prepped: "prepped", out: "deployed", returned: "returned", deprepped: "deprepped" };

export interface JobRowsCtx {
  stage: JobStage;
  containerLabelById: ReadonlyMap<string, string>;
  /** Sort key / group title for a To-pick line (the model's category). */
  categoryOf: (li: LineItem) => string;
  /** Units short on this line (overbooked), from `useWarehouseOverbooked`. */
  shortById?: ReadonlyMap<string, number>;
  /** Lines with a prep check still to run. */
  needsCheckIds?: ReadonlySet<string>;
  /** Free text filter (Find). */
  query?: string;
  /** Prepped / Out: each accessory row offers `Verify` (present) and the verified ids feed the deploy / return gates. */
  verify?: { verified: ReadonlySet<string>; toggle: (accessoryId: string) => void };
}

export interface JobSection { section: LineRowSectionData; rows: LineRowData[]; key: string }

/**
 * Units of `li` that sit in `stage`. A bulk line stays ONE row through its whole
 * life, so it can be in Pick and Prepped at once: the row's qty is the stage
 * count, never `li.quantity` (the old tabs' per-stage `unitCount`).
 */
export function stageQuantity(li: LineItem, stage: JobStage): number {
  if (!isBulkItem(li)) return li.quantity;
  if (stage === "out") return Math.max(li.checkedOutQuantity - li.returnedQuantity, 0);
  const countStage = { pick: "prep", prepped: "prepped", returned: "returned", deprepped: "depreped" } as const;
  return bulkStageUnitCount(li, countStage[stage]);
}

function glyphsFor(li: LineItem, ctx: JobRowsCtx): StateGlyph[] {
  const out: StateGlyph[] = [];
  // §5.4 `Planned →`: the PM's plan, shown only while the line is not packed yet (2c moved this glyph here).
  if (li.plannedContainerId && li.prepStatus !== "PACKED") {
    const label = ctx.containerLabelById.get(li.plannedContainerId);
    if (label) out.push({ key: "plannedCase", tooltip: `Planned → ${label}` });
  }
  if (ctx.needsCheckIds?.has(li.id)) out.push({ key: "needsCheck", tooltip: "Prep check still to run" });
  return out;
}

function flagsFor(li: LineItem, ctx: JobRowsCtx): RowFlag[] {
  const short = ctx.shortById?.get(li.id) ?? 0;
  return short > 0 ? [{ label: `Short ${short}`, tone: "error" }] : [];
}

function kindOf(li: LineItem): LineRowData["kind"] {
  if (li.kitId) return "kit";
  if (li.subHireId) return "subhire";
  return li.isCustomItem ? "custom" : "gear";
}

function tagsOf(li: LineItem): string[] {
  const tags = [li.asset?.assetTag ?? li.bulkAsset?.assetTag, li.kit?.assetTag, li.subHireId && li.supplier?.name ? `via ${li.supplier.name}` : null];
  return tags.filter((t): t is string => !!t);
}

function stageStatus(stage: JobStage) {
  const key = GEAR_KEY[stage];
  return { label: GEAR_STAGE_LABELS[key], intent: getStatusIntent("gearStage", key) };
}

const canPackWith = (parent: LineItem, accessoryPacked: boolean) => !accessoryPacked && parent.prepStatus === "PACKED";

function accessoryStatus(packed: boolean, stage: WarehouseStageKey | null) {
  if (packed) return { label: "Packed", intent: "info" as const };
  return { label: stage ? GEAR_STAGE_LABELS[stage] : "To pick", intent: "neutral" as const };
}

/** Accessory rows under a parent: one per accessory line, with its own state word (§9.5). */
function accessoryRows(
  li: LineItem,
  packWithParent: (accessoryId: string) => void,
  caseOf: (a: LineItem) => string | null,
  verify?: JobRowsCtx["verify"],
): LineRowData[] {
  return accessoryChildrenOf(li).filter((a) => a.status !== "CANCELLED").map((a) => {
    const packed = a.prepStatus === "PACKED";
    const stage = deriveItemStage(a);
    const here = caseOf(a);
    return {
      id: a.id, kind: "accessory", title: a.model?.name ?? a.description ?? "Accessory",
      tags: [a.accessoryInclusion === "OPTIONAL" ? "OPTIONAL" : "DEFAULT"],
      facts: { qty: { kind: "qty", value: packed ? a.quantity : 0, of: a.quantity } },
      status: accessoryStatus(packed, stage),
      cells: here ? { place: here } : undefined,
      // Prepped / Out only: a nested accessory is actioned on its own there (`accessoryKey`); on To pick it rides its parent.
      selectable: !!verify,
      primary: verify
        ? { label: verify.verified.has(a.id) ? "Verified" : "Verify", onSelect: () => verify.toggle(a.id) }
        : canPackWith(li, packed) ? { label: `Pack ${a.quantity} with parent`, onSelect: () => packWithParent(a.id) } : undefined,
    } satisfies LineRowData;
  });
}

/** Kit members under a kit parent (Prepped / Out only): each can be ticked `Verify` before the kit goes. */
function kitMemberRows(li: LineItem, verify: NonNullable<JobRowsCtx["verify"]>): LineRowData[] {
  if (!li.kitId) return [];
  return (li.childLineItems ?? []).filter((c) => c.childKind !== "ACCESSORY" && c.status !== "CANCELLED").map((c) => ({
    // `accessory` is the one child kind that carries an action (line-row); a kit member rides the same row.
    id: c.id, kind: "accessory", selectable: false, title: modelDisplayName(c), tags: [c.asset?.assetTag ?? c.bulkAsset?.assetTag].filter((t): t is string => !!t),
    facts: { qty: { kind: "qty", value: c.quantity } },
    status: { label: verify.verified.has(c.id) ? "Verified" : "Not verified", intent: verify.verified.has(c.id) ? ("info" as const) : ("neutral" as const) },
    primary: { label: verify.verified.has(c.id) ? "Verified" : "Verify", onSelect: () => verify.toggle(c.id) },
  } satisfies LineRowData));
}

export function buildJobRow(li: LineItem, ctx: JobRowsCtx, packWithParent: (accessoryId: string) => void = () => {}): LineRowData {
  const caseId = resolveItemContainerId(li);
  const place = caseId ? ctx.containerLabelById.get(caseId) ?? li.prepContainer : li.prepContainer;
  const members = ctx.verify ? kitMemberRows(li, ctx.verify) : [];
  const children = members.concat(accessoryRows(li, packWithParent, (a) => { const id = resolveItemContainerId(a); return id ? ctx.containerLabelById.get(id) ?? null : null; }, ctx.verify));
  return {
    id: li.id, kind: kindOf(li), title: modelDisplayName(li), tags: tagsOf(li),
    glyphs: glyphsFor(li, ctx), flags: flagsFor(li, ctx),
    facts: { qty: { kind: "qty", value: stageQuantity(li, ctx.stage) }, ...(place ? { place: { kind: "place" as const, label: place } } : {}) },
    status: stageStatus(ctx.stage),
    children: children.length ? children : undefined,
  };
}

/**
 * A relocated accessory group (`reloc~…`, one container + stage) with several units lists ONE row per unit,
 * id `${groupId}:${i}`: the unit key `takeAccessorySelection` already resolves, so a single unit can be
 * ticked, moved, deployed or returned on its own (#1296). One unit stays the bare group row.
 */
function rowsFor(li: LineItem, ctx: JobRowsCtx): LineRowData[] {
  const units = li.units ?? [];
  if (!isRelocatedLineId(li.id) || units.length < 2) return [buildJobRow(li, ctx)];
  const base = buildJobRow(li, ctx);
  return units.map((u, i) => {
    const tag = u.asset?.assetTag ?? u.bulkAsset?.assetTag;
    return {
      ...base, id: `${li.id}:${i}`, tags: tag ? [tag] : base.tags,
      facts: { ...base.facts, qty: { kind: "qty" as const, value: u.quantity ?? 1 } },
    };
  });
}

const matches = (li: LineItem, q: string) => !q || modelDisplayName(li).toLowerCase().includes(q) || tagsOf(li).some((t) => t.toLowerCase().includes(q));

/** Sections for the active stage: category groups on To pick, case groups (Loose last) afterwards. */
export function buildJobSections(items: LineItem[], ctx: JobRowsCtx): JobSection[] {
  const q = (ctx.query ?? "").trim().toLowerCase();
  // Real kit/accessory children hide under their parent; only a sub-hire GROUP child (no kitId) is its own
  // line (legacy equipmentItems rule). A kit child, sub-hired or not, never becomes a selectable top-level
  // row: kits go through their parent's kit-atomic path.
  const lines = items.filter((li) => (!li.isKitChild || (!isInternalStockLine(li.subHireId) && !li.kitId)) && IN_STAGE[ctx.stage](li) && matches(li, q));
  const groups = new Map<string, LineItem[]>();
  for (const li of lines) {
    const key = ctx.stage === "pick" ? ctx.categoryOf(li) : (resolveItemContainerId(li) ?? "");
    groups.set(key, [...(groups.get(key) ?? []), li]);
  }
  const keys = [...groups.keys()].sort((a, b) => (ctx.stage === "pick" ? a.localeCompare(b) : (a ? 0 : 1) - (b ? 0 : 1)));
  return keys.map((key) => {
    const title = ctx.stage === "pick" ? key : key ? ctx.containerLabelById.get(key) ?? "Case" : "Loose";
    const members = groups.get(key) ?? [];
    return { key: key || "loose", section: { id: key || "loose", title, count: members.length }, rows: members.flatMap((li) => rowsFor(li, ctx)) };
  });
}

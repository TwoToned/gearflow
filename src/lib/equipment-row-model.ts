/**
 * Job > Equipment row model (UX unification phase 2a, spec §7.1): maps the
 * reconstructed `LineItemData` to the shared `LineRowData`. Pure and
 * React-free so every fact, flag, glyph and the stage word is unit-testable.
 *
 * Nothing here is stored or re-summed (CLAUDE.md money rules): money facts
 * carry the row's OWN stored `unitPrice` / `lineTotal`, and a missing price is
 * `null` (a BLANK, never $0). The discount AMOUNT is stored; this module never
 * derives or writes a percentage. Rollup-hidden state is the DERIVED
 * `isRowPriceHidden` decision, not a stored flag.
 */
import type { LineItemData } from "@/components/projects/equipment-row-types";
import { describeRow } from "@/components/projects/equipment-row-descriptors";
import { isLinePriceHidden } from "@/lib/category-pricing-display";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { Fact, FactColumn, RowFlag, RowKind, StateGlyph } from "@/lib/primitives/types";
import type { GearStageKey } from "@/lib/vocabulary";

/** The desktop columns the Equipment list shows, in order (spec §7.1). */
export const EQUIPMENT_COLUMNS: FactColumn[] = [
  { id: "availability", header: "Availability" },
  { id: "status", header: "Stage" },
  { id: "qty", header: "Qty", align: "end" },
  { id: "unit", header: "Unit", align: "end" },
  { id: "total", header: "Total", align: "end" },
];

/** What the row needs from its surroundings; everything is optional. */
export interface EquipmentRowCtx {
  overbooked?: OverbookedInfo | null;
  /** Category is a combined-price (ROLLUP) category. */
  inRollupCategory?: boolean;
  inProjectGroup?: boolean;
  /** The sub-hire order backing this line is still a draft. */
  draftOrder?: boolean;
  /** An open needs-review / follow-up marker exists on this line. */
  hasOpenMarker?: boolean;
  /** Name of the planned case, for the glyph tooltip. */
  plannedCaseLabel?: string;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowKind(item: LineItemData): RowKind {
  const d = describeRow(item);
  if (d.source === "container") return "container";
  if (d.isKit) return "kit";
  if (d.source === "subhire") return "subhire";
  if (d.source === "custom") return "custom";
  if (d.source === "sale") return "sale";
  return "gear";
}

const KIND_TAG: Partial<Record<RowKind, string>> = {
  kit: "Kit",
  subhire: "Sub-hire",
  custom: "Custom",
  sale: "Sale",
  container: "Container",
};

/** Serials assigned to the line, e.g. `LX-01, LX-02`; empty when none. */
function serialsText(item: LineItemData): string | undefined {
  const tags = (item.units ?? [])
    .map((u) => u.asset?.assetTag ?? u.bulkAsset?.assetTag)
    .filter((t): t is string => !!t);
  if (tags.length === 0 && item.asset?.assetTag) tags.push(item.asset.assetTag);
  return tags.length ? tags.join(", ") : undefined;
}

function subtitleOf(item: LineItemData, ctx: EquipmentRowCtx): string | undefined {
  const parts: string[] = [];
  const serials = serialsText(item);
  if (serials) parts.push(serials);
  if (item.supplier?.name && item.showSubhireOnDocs) parts.push(`via ${item.supplier.name}`);
  if (ctx.plannedCaseLabel) parts.push(ctx.plannedCaseLabel);
  if (item.notes) parts.push(item.notes);
  return parts.length ? parts.join(" · ") : undefined;
}

/** The state the live tab kept invisible, as glyphs with tooltips (spec §5.4). */
export function glyphsFor(item: LineItemData, ctx: EquipmentRowCtx): StateGlyph[] {
  const out: StateGlyph[] = [];
  const hidden = isLinePriceHidden({ pricingDisplay: ctx.inRollupCategory ? "ROLLUP" : "ITEMISED", revealPriceInRollup: item.revealPriceInRollup });
  if (hidden) out.push({ key: "priceHidden", tooltip: "Price hidden: shown in the category's combined price" });
  if (item.isOptional) out.push({ key: "optional", tooltip: "Optional: not in the total until accepted" });
  if (item.excludeFromRoi) out.push({ key: "excludedFromRoi", tooltip: "Excluded from ROI" });
  if (item.priceOverridden) out.push({ key: "manualPrice", tooltip: "Price set by hand" });
  if (ctx.hasOpenMarker) out.push({ key: "needsCheck", tooltip: "Needs review or follow-up" });
  if (ctx.plannedCaseLabel) out.push({ key: "plannedCase", tooltip: `Planned → ${ctx.plannedCaseLabel}` });
  return out;
}

function shortFlag(info: OverbookedInfo): RowFlag {
  // Pencilled-only overage is softer than a hard conflict (OverbookedBadge's rule).
  const pencilled = !info.inherited && (info.hardOverBy ?? info.overBy) === 0;
  return { label: `Short ${info.overBy}`, tone: pencilled || info.inherited ? "warning" : "error" };
}

/** Problems are an error word, "needs you" items a warning word (vocabulary §4). */
export function flagsFor(item: LineItemData, ctx: EquipmentRowCtx): RowFlag[] {
  const out: RowFlag[] = [];
  if (ctx.overbooked && ctx.overbooked.overBy > 0) out.push(shortFlag(ctx.overbooked));
  // Blank price is a missing price, not a $0 one: both a locked-add and a null read as Unpriced.
  if (item.pricedUnderLock || (!item.isKitChild && numOrNull(item.unitPrice) == null && !item.isContainerLineItem)) {
    out.push({ label: "Unpriced", tone: "warning" });
  }
  if (ctx.draftOrder) out.push({ label: "Draft order", tone: "warning" });
  return out;
}

function availabilityFact(item: LineItemData, ctx: EquipmentRowCtx): Fact | undefined {
  const d = describeRow(item);
  if (d.isSubhire) return { kind: "text", label: item.supplier?.name ? `External · ${item.supplier.name}` : "External" };
  if (d.isSale || d.source === "container") return undefined;
  if (ctx.overbooked && ctx.overbooked.overBy > 0) return { kind: "availability", state: "short", short: ctx.overbooked.overBy };
  return { kind: "availability", state: "ok" };
}

/** Gear stage for the row's StatusWord; `undefined` while nothing has happened. */
export function stageOf(item: LineItemData): GearStageKey | undefined {
  if (item.status === "CHECKED_OUT") return "deployed";
  if (item.status === "RETURNED") return "returned";
  if (item.prepStatus === "PACKED" || item.status === "PREPPED") return "prepped";
  return undefined;
}

export interface EquipmentRowModel {
  kind: RowKind;
  title: string;
  subtitle?: string;
  tags: string[];
  glyphs: StateGlyph[];
  flags: RowFlag[];
  facts: Record<string, Fact>;
  stage?: GearStageKey;
}

/** Everything `LineRowData` needs from a line, minus menu/cells/handlers (the caller adds those). */
export function equipmentRowModel(item: LineItemData, ctx: EquipmentRowCtx = {}): EquipmentRowModel {
  const kind = rowKind(item);
  const facts: Record<string, Fact> = {
    qty: { kind: "qty", value: item.quantity },
    unit: { kind: "money", amount: numOrNull(item.unitPrice) },
    total: { kind: "money", amount: numOrNull(item.lineTotal) },
  };
  const availability = availabilityFact(item, ctx);
  if (availability) facts.availability = availability;
  const tag = KIND_TAG[kind];
  return {
    kind,
    title: item.description || item.model?.name || "Item",
    subtitle: subtitleOf(item, ctx),
    tags: tag ? [tag] : [],
    glyphs: glyphsFor(item, ctx),
    flags: flagsFor(item, ctx),
    facts,
    stage: stageOf(item),
  };
}

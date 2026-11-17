import * as React from "react";
import { PackageOpen, Undo2 } from "lucide-react";

import { gearStageValue } from "@/components/ui/status-word";
import type { LineRowListSection } from "@/components/ui/line-row";
import { canEditAccessoryPlan } from "@/lib/accessory-plan-eligibility";
import { EQUIPMENT_COLUMNS, equipmentRowModel, type EquipmentRowCtx } from "@/lib/equipment-row-model";
import type { InlineLineItemPatch } from "@/lib/line-item-edit-payload";
import { canConvertBackToInventory, canConvertToCustomUnit } from "@/lib/off-inventory";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { ActionItem, FactColumn, LineRowData, LineRowSectionData, RowSelection } from "@/lib/primitives/types";
import { buildCategoryActions } from "@/lib/row-actions/category";
import { buildGearLineActions } from "@/lib/row-actions/gear-line";
import { buildGroupActions } from "@/lib/row-actions/group";
import { buildSubHireActions } from "@/lib/row-actions/subhire";
import type { CustomUnitContextValue } from "./custom-unit-context";
import { toCustomUnitLine } from "./equipment-row-descriptors";
import type { CategoryData, GroupData, LineItemData, MixedGroupSlot, SubHireGroupData } from "./equipment-row-types";
import type { GroupInlinePricePatch } from "./equipment-rows";
import { isHiddenFromList } from "./equipment-rows";
import type { SortableMeta } from "./equipment-list-dnd";
import { lineGrossAmount } from "@/lib/discount-mode";
import { CommentButton, StageCell, type CommentTarget } from "./equipment-row-extras";
import { InlineEditableDiscount, InlineEditablePrice, InlineEditableQuantity } from "./line-item-inline-cells";

/**
 * Turns the reconstructed Equipment data into `LineRowList` sections (spec
 * §7.1). Pure apart from the JSX in `cells`: every handler is the tab's own
 * closure, so nothing here writes anything.
 *
 * Shape: one section per category, its Project Groups / sub-hire groups as
 * depth-1 sections, and an Uncategorised section. A category's loose lines and
 * groups interleave in the user's stored order, so loose lines that follow a
 * group become a HEADLESS section (rows, no head) rather than being reordered.
 */

const COST_COLUMN: FactColumn = { id: "cost", header: "Cost", align: "end" };

/** Inline discount (`$`/`%`): a cells-only column, there is no discount FACT (the stored dollar amount is edited, never a derived %). */
const DISCOUNT_COLUMN: FactColumn = { id: "discount", header: "Disc.", align: "end" };

/** The list's columns: Disc. follows Unit; Cost (sub-hire groups only) sits before Total when margin is shown. */
export function equipmentColumns(showCost: boolean): FactColumn[] {
  return EQUIPMENT_COLUMNS.flatMap((c) => {
    if (c.id === "unit") return [c, DISCOUNT_COLUMN];
    if (c.id === "total" && showCost) return [COST_COLUMN, c];
    return [c];
  });
}

interface Placement {
  categoryId?: string;
  groupId?: string;
}

export interface EquipmentHandlers {
  editLine: (item: LineItemData, placement: Placement) => void;
  moveLineToCategory: (id: string, initialCategoryId?: string) => void;
  moveLineToGroup: (id: string, initialGroupId?: string) => void;
  editAccessories: (item: LineItemData) => void;
  removeLine: (id: string) => void;
  inlineUpdate: (item: LineItemData, patch: InlineLineItemPatch) => Promise<unknown>;
  toggleLinePriceReveal: (item: LineItemData) => void;
  toggleLineDisclosure: (item: LineItemData) => void;
  toggleLineRoi: (item: LineItemData) => void;
  setMarker: (id: string, status: "needs_review" | "follow_up" | "resolved") => void;
  reportIssue: (item: LineItemData) => void;
  editInOrder: (subHireId: string) => void;
  // categories
  setCategoryCollapsed: (id: string, collapsed: boolean) => void;
  renameCategory: (cat: CategoryData) => void;
  removeCategory: (cat: CategoryData) => void;
  setPricingDisplay: (cat: CategoryData, next: "ITEMISED" | "ROLLUP") => void;
  addToTarget: (target: { categoryId?: string; groupId?: string; label: string }, kind: "own-stock" | "kit" | "custom") => void;
  // project groups
  toggleGroup: (id: string) => void;
  editGroup: (group: GroupData) => void;
  editGroupPrice: (group: GroupData) => void;
  removeGroup: (group: GroupData, itemCount: number) => void;
  saveGroupAsTemplate: (group: GroupData) => void;
  moveGroup: (group: GroupData) => void;
  toggleGroupPriceReveal: (group: GroupData) => void;
  inlineGroupPrice: (group: GroupData, patch: GroupInlinePricePatch) => Promise<unknown>;
  // sub-hire groups
  editSubHirePrice: (group: SubHireGroupData) => void;
  moveSubHireGroup: (group: SubHireGroupData) => void;
  inlineSubHirePrice: (group: SubHireGroupData, patch: { cost?: number | null; charge?: number | null }) => Promise<unknown>;
}

export interface EquipmentSectionsInput {
  categories: CategoryData[];
  uncategorizedItems: LineItemData[];
  orphanProjectGroups: GroupData[];
  orphanSubHireGroups: SubHireGroupData[];
  collapsedCategories: ReadonlySet<string>;
  expandedGroups: ReadonlySet<string>;
  pendingRemovalIds: ReadonlySet<string>;
  overbookedMap: Record<string, OverbookedInfo>;
  markerByTarget?: Map<string, { status: string; reason?: string }>;
  draftSubHireIds: ReadonlySet<string>;
  moneyLocked: boolean;
  canDrag: boolean;
  showCost: boolean;
  customUnit?: CustomUnitContextValue | null;
  /** Discussion badges (per line and per Project Group); absent = none rendered. */
  comments?: CommentTarget;
  handlers: EquipmentHandlers;
}

export interface EquipmentSections {
  sections: LineRowListSection[];
  /** Sortable metadata by LINE id (`row.id`) and by SECTION id, read by `wrapRow` / `wrapSection`. */
  rowMeta: Map<string, SortableMeta>;
  sectionMeta: Map<string, SortableMeta>;
}

type Ctx = EquipmentSectionsInput & {
  rowMeta: Map<string, SortableMeta>;
  sectionMeta: Map<string, SortableMeta>;
};

const liId = (id: string) => `li-${id}`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const isVisible = (c: Ctx, i: LineItemData) => !isHiddenFromList(i) && !c.pendingRemovalIds.has(i.id);

// ─── gear lines ────────────────────────────────────────────────────────────

function customUnitItems(item: LineItemData, c: Ctx, over?: OverbookedInfo | null): ActionItem[] {
  const cu = c.customUnit;
  if (!cu || cu.pendingLineIds.has(item.id)) return [];
  const line = toCustomUnitLine(item);
  const out: ActionItem[] = [];
  if (canConvertToCustomUnit(line, over)) {
    out.push({ key: "to-custom", label: "Convert 1 to custom item", group: "edit", icon: PackageOpen, onSelect: () => cu.convert(item.id) });
  }
  if (canConvertBackToInventory(line)) {
    out.push({ key: "to-inventory", label: "Convert 1 back to inventory", group: "edit", icon: Undo2, onSelect: () => cu.convertBack(item.id) });
  }
  return out;
}

function lineCells(item: LineItemData, c: Ctx, model: ReturnType<typeof equipmentRowModel>): Record<string, React.ReactNode> {
  const editable = model.kind !== "container" && item.subHireGroupId == null;
  const stage = (
    <StageCell
      status={model.stage ? gearStageValue(model.stage) : undefined}
      item={item}
      comments={c.comments}
      disableReassign={item.childKind === "ACCESSORY"}
    />
  );
  if (!editable) return { status: stage };
  return {
    status: stage,
    discount: (
      <InlineEditableDiscount
        discount={item.discount != null && Number(item.discount) > 0 ? Number(item.discount) : null}
        discountMode={item.discountMode}
        gross={lineGrossAmount({ unitPrice: num(item.unitPrice), quantity: item.quantity, duration: item.duration })}
        disabled={c.moneyLocked}
        onSave={(amount, mode) => c.handlers.inlineUpdate(item, { field: "discount", value: amount, discountMode: mode })}
      />
    ),
    qty: (
      <InlineEditableQuantity
        value={item.quantity}
        onSave={(next, allowOverbook) => c.handlers.inlineUpdate(item, { field: "quantity", value: next, allowOverbook })}
      />
    ),
    unit: (
      <InlineEditablePrice
        value={num(item.unitPrice)}
        disabled={c.moneyLocked}
        onSave={(next) => c.handlers.inlineUpdate(item, { field: "unitPrice", value: next })}
      />
    ),
  };
}

function childRows(item: LineItemData): LineRowData[] | undefined {
  const kids = (item.childLineItems ?? []) as LineItemData[];
  if (kids.length === 0) return undefined;
  return kids.map((k) => {
    const m = equipmentRowModel(k);
    const accessory = k.childKind === "ACCESSORY";
    return {
      id: k.id,
      kind: accessory ? "accessory" : "gear",
      title: m.title,
      subtitle: m.subtitle,
      facts: { qty: m.facts.qty, unit: m.facts.unit, total: m.facts.total },
      // A kit member's serial swap / an accessory's serial list, as live.
      cells: { status: <StageCell item={k} kitMember={!accessory} disableReassign={accessory} /> },
    };
  });
}

interface LineWhere {
  catId?: string;
  groupId?: string;
  inRollup: boolean;
  inGroup: boolean;
  container?: string;
}

function lineRow(item: LineItemData, c: Ctx, where: LineWhere): LineRowData {
  const over = item.subHireId != null ? undefined : c.overbookedMap[item.id];
  const marker = c.markerByTarget?.get(item.id);
  const hasOpenMarker = !!marker && marker.status !== "resolved";
  const ctx: EquipmentRowCtx = {
    overbooked: over,
    inRollupCategory: where.inRollup,
    inProjectGroup: where.inGroup,
    draftOrder: !!item.subHireId && c.draftSubHireIds.has(item.subHireId),
    hasOpenMarker,
  };
  const model = equipmentRowModel(item, ctx);
  const h = c.handlers;
  const place: Placement = { categoryId: where.catId, groupId: where.groupId };
  return {
    id: item.id,
    kind: model.kind,
    title: model.title,
    subtitle: model.subtitle,
    tags: model.tags,
    glyphs: model.glyphs,
    flags: model.flags,
    facts: model.facts,
    status: model.stage ? gearStageValue(model.stage) : undefined,
    cells: lineCells(item, c, model),
    children: childRows(item),
    onOpen: () => h.editLine(item, place),
    menu: buildGearLineActions(
      { ...item, title: model.title, hasOpenMarker },
      {
        inRollupCategory: where.inRollup,
        inProjectGroup: where.inGroup,
        isSubHireGroupChild: item.subHireGroupId != null,
        onEdit: () => h.editLine(item, place),
        onMoveToCategory: () => h.moveLineToCategory(item.id, where.catId),
        onMoveToGroup: () => h.moveLineToGroup(item.id, where.groupId),
        onEditAccessories: canEditAccessoryPlan(item) ? () => h.editAccessories(item) : undefined,
        onMarker: (s) => h.setMarker(item.id, s),
        onReportIssue: item.status === "CHECKED_OUT" ? () => h.reportIssue(item) : undefined,
        onTogglePriceReveal: () => h.toggleLinePriceReveal(item),
        onToggleGroupDisclosure: () => h.toggleLineDisclosure(item),
        onToggleRoiExclusion: () => h.toggleLineRoi(item),
        onRemove: () => h.removeLine(item.id),
        extraItems: customUnitItems(item, c, over),
      },
    ),
  };
}

/** A line the sub-hire order owns: no select box, no price edits, its menu opens the order. */
function subHireChildRow(item: LineItemData, shGroup: SubHireGroupData, c: Ctx): LineRowData {
  const model = equipmentRowModel(item, { draftOrder: c.draftSubHireIds.has(shGroup.subHire.id) });
  const open = () => c.handlers.editInOrder(shGroup.subHire.id);
  return {
    id: item.id,
    kind: model.kind,
    title: model.title,
    subtitle: model.subtitle,
    tags: model.tags,
    glyphs: model.glyphs,
    flags: model.flags,
    facts: model.facts,
    selectable: false,
    children: childRows(item),
    onOpen: open,
    menu: buildSubHireActions({ title: model.title }, { onEditInOrder: open }),
  };
}

function register(c: Ctx, row: LineRowData, container: string, ids: string[], disabled: boolean) {
  c.rowMeta.set(row.id, { sortableId: liId(row.id), containerId: container, items: ids, disabled });
}

function lineRows(items: LineItemData[], c: Ctx, where: LineWhere, container: string, containerIds: string[]): LineRowData[] {
  return items.map((it) => {
    const row = lineRow(it, c, where);
    register(c, row, container, containerIds, !c.canDrag);
    return row;
  });
}

// ─── sections ──────────────────────────────────────────────────────────────

function sectionMetaFor(c: Ctx, id: string, container: string, items: string[], disabled: boolean) {
  c.sectionMeta.set(id, { sortableId: id, containerId: container, items, disabled });
}

function projectGroupSection(group: GroupData, cat: CategoryData | null, container: string, containerIds: string[], c: Ctx): LineRowListSection {
  const h = c.handlers;
  const id = `grp-${group.id}`;
  const items = (group.lineItems ?? []).filter((i) => isVisible(c, i));
  const inRollup = cat?.pricingDisplay === "ROLLUP";
  const where = cat?.id ?? undefined;
  const label = `${cat?.name ?? "Uncategorized"} > ${group.title}`;
  const section: LineRowSectionData = {
    id,
    title: group.title,
    count: items.length,
    depth: 1,
    menu: buildGroupActions(
      { title: group.title, revealPriceInRollup: group.revealPriceInRollup },
      {
        inRollupCategory: inRollup,
        onEdit: () => h.editGroup(group),
        onEditPrice: () => h.editGroupPrice(group),
        onAddEquipment: () => h.addToTarget({ categoryId: where, groupId: group.id, label }, "own-stock"),
        onAddKit: () => h.addToTarget({ categoryId: where, groupId: group.id, label }, "kit"),
        onSaveAsTemplate: cat ? () => h.saveGroupAsTemplate(group) : undefined,
        onMoveToCategory: () => h.moveGroup(group),
        onTogglePriceReveal: () => h.toggleGroupPriceReveal(group),
        onRemove: () => h.removeGroup(group, items.length),
      },
    ),
    cells: {
      ...(c.comments ? { status: <CommentButton target={c.comments} lineId={group.id} targetType="group" /> } : {}),
      qty: <span className="text-table-cell text-ink-2">{group.quantity}</span>,
      discount: (
        <InlineEditableDiscount
          discount={group.discount != null && Number(group.discount) > 0 ? Number(group.discount) : null}
          discountMode={group.discountMode}
          gross={lineGrossAmount({ unitPrice: num(group.price), quantity: group.quantity, duration: 1 })}
          disabled={c.moneyLocked}
          onSave={(amount, mode) => h.inlineGroupPrice(group, { field: "discount", value: amount, discountMode: mode })}
        />
      ),
      total: (
        <InlineEditablePrice
          value={num(group.price)}
          disabled={c.moneyLocked}
          onSave={(next) => h.inlineGroupPrice(group, { field: "price", value: next })}
        />
      ),
    },
  };
  sectionMetaFor(c, id, container, containerIds, !c.canDrag || !cat);
  const collapsed = !c.expandedGroups.has(group.id);
  const memberIds = items.map((i) => liId(i.id));
  const rows = collapsed
    ? []
    : lineRows(items, c, { catId: cat?.id, groupId: group.id, inRollup, inGroup: true }, `items:${group.id}`, memberIds);
  return {
    section,
    rows,
    collapsed,
    onCollapsedChange: () => h.toggleGroup(group.id),
  };
}

function subHireGroupSection(group: SubHireGroupData, cat: CategoryData | null, container: string, containerIds: string[], c: Ctx): LineRowListSection {
  const h = c.handlers;
  const id = `shg-${group.id}`;
  const parent = (group.lineItems ?? [])[0];
  const kids = ((parent?.childLineItems ?? []) as LineItemData[]).filter((i) => isVisible(c, i));
  const section: LineRowSectionData = {
    id,
    title: group.title,
    count: kids.length,
    depth: 1,
    flags: c.draftSubHireIds.has(group.subHire.id) ? [{ label: "Draft order", tone: "warning" }] : undefined,
    menu: buildSubHireActions(
      { title: group.title },
      {
        onEditInOrder: () => h.editInOrder(group.subHire.id),
        onEditPrice: () => h.editSubHirePrice(group),
        onMoveToCategory: () => h.moveSubHireGroup(group),
      },
    ),
    cells: {
      qty: <span className="text-table-cell text-ink-2">{group.quantity}</span>,
      cost: (
        <InlineEditablePrice
          value={num(group.cost)}
          onSave={(next) => h.inlineSubHirePrice(group, { cost: next ?? null })}
        />
      ),
      total: (
        <InlineEditablePrice
          value={num(group.charge)}
          onSave={(next) => h.inlineSubHirePrice(group, { charge: next ?? null })}
        />
      ),
    },
  };
  sectionMetaFor(c, id, container, containerIds, !c.canDrag || !cat);
  const collapsed = !c.expandedGroups.has(group.id);
  return {
    section,
    rows: collapsed ? [] : kids.map((k) => subHireChildRow(k, group, c)),
    collapsed,
    onCollapsedChange: () => h.toggleGroup(group.id),
  };
}

function slotIds(slots: MixedGroupSlot[]): string[] {
  return slots.map((s) => (s.kind === "project" ? `grp-${s.projectGroupId}` : s.kind === "subHire" ? `shg-${s.subHireGroupId}` : liId(s.lineItemId)));
}

function categorySlots(cat: CategoryData): MixedGroupSlot[] {
  return cat.mixedGroups ?? cat.groups.map<MixedGroupSlot>((g) => ({ kind: "project", sortOrder: g.sortOrder, projectGroupId: g.id }));
}

function categoryHead(cat: CategoryData, count: number, c: Ctx): LineRowSectionData {
  const h = c.handlers;
  const target = (kind: "own-stock" | "kit" | "custom") => () => h.addToTarget({ categoryId: cat.id, label: cat.name }, kind);
  return {
    id: `cat-${cat.id}`,
    title: cat.name,
    count,
    menu: buildCategoryActions(
      { name: cat.name, pricingDisplay: cat.pricingDisplay },
      {
        onAddEquipment: target("own-stock"),
        onAddKit: target("kit"),
        onAddCustom: target("custom"),
        onRename: () => h.renameCategory(cat),
        onSetPricingDisplay: (next) => h.setPricingDisplay(cat, next),
        onRemove: () => h.removeCategory(cat),
      },
    ),
  };
}

function categorySections(cat: CategoryData, catIds: string[], c: Ctx): LineRowListSection[] {
  const container = `mixed:${cat.id}`;
  const slots = categorySlots(cat);
  const ids = slotIds(slots);
  const loose = (cat.lineItems ?? []).filter((i) => isVisible(c, i));
  const where: LineWhere = { catId: cat.id, inRollup: cat.pricingDisplay === "ROLLUP", inGroup: false };
  const collapsed = c.collapsedCategories.has(cat.id);
  const head: LineRowListSection = {
    section: categoryHead(cat, loose.length + cat.groups.length, c),
    rows: [],
    collapsed,
    onCollapsedChange: (next) => c.handlers.setCategoryCollapsed(cat.id, next),
  };
  sectionMetaFor(c, `cat-${cat.id}`, "categories", catIds, !c.canDrag);
  const out: LineRowListSection[] = [head];
  if (collapsed) return out;
  let run: LineItemData[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const rows = lineRows(run, c, where, container, ids);
    if (out.length === 1) head.rows = rows;
    else out.push({ section: { id: `mix-${cat.id}-${out.length}`, title: "" }, headless: true, rows });
    run = [];
  };
  for (const slot of slots) {
    if (slot.kind === "lineItem") {
      const it = loose.find((i) => i.id === slot.lineItemId);
      if (it) run.push(it);
      continue;
    }
    flush();
    if (slot.kind === "project") {
      const g = cat.groups.find((x) => x.id === slot.projectGroupId);
      if (g) out.push(projectGroupSection(g, cat, container, ids, c));
    } else {
      const sg = (cat.subHireGroupTargets ?? []).find((x) => x.id === slot.subHireGroupId);
      if (sg) out.push(subHireGroupSection(sg, cat, container, ids, c));
    }
  }
  flush();
  return out;
}

function uncategorisedSections(c: Ctx): LineRowListSection[] {
  const loose = c.uncategorizedItems.filter((i) => isVisible(c, i));
  const groupIds = [...c.orphanProjectGroups.map((g) => `grp-${g.id}`), ...c.orphanSubHireGroups.map((g) => `shg-${g.id}`)];
  const where: LineWhere = { inRollup: false, inGroup: false };
  const out: LineRowListSection[] = [
    {
      section: { id: "uncat-zone", title: "Uncategorised", count: loose.length },
      rows: lineRows(loose, c, where, "uncategorized-standalone", loose.map((i) => liId(i.id))),
    },
  ];
  for (const g of c.orphanProjectGroups) out.push(projectGroupSection(g, null, "uncategorized-groups", groupIds, c));
  for (const sg of c.orphanSubHireGroups) out.push(subHireGroupSection(sg, null, "uncategorized-groups", groupIds, c));
  return out;
}

/**
 * Adds each head's tri-state "tick all" box. A category covers its own rows plus
 * the rows of the groups nested under it; a group covers its own. Derived from
 * the live selection, so it runs AFTER `useRowSelection` (which is fed the
 * visible ids from the un-decorated sections). `selectable: false` rows are
 * never covered.
 */
export function withSectionSelection(sections: LineRowListSection[], selection: RowSelection): LineRowListSection[] {
  const covers: string[][] = sections.map(() => []);
  let owner = -1;
  sections.forEach((s, i) => {
    const ids = s.rows.filter((r) => r.selectable !== false).map((r) => r.id);
    const top = !s.headless && (s.section.depth ?? 0) === 0;
    if (top) owner = i;
    covers[i].push(...ids);
    if (!top && owner >= 0) covers[owner].push(...ids);
  });
  return sections.map((s, i) => {
    const ids = covers[i];
    if (s.headless || ids.length === 0) return s;
    const picked = ids.filter((id) => selection.isSelected(id));
    const selectState = picked.length === 0 ? "none" : picked.length === ids.length ? "all" : "some";
    const onToggleSelect = () => {
      for (const id of selectState === "all" ? ids : ids.filter((x) => !selection.isSelected(x))) selection.toggle(id);
    };
    return { ...s, section: { ...s.section, selectState, onToggleSelect } };
  });
}

export function buildEquipmentSections(input: EquipmentSectionsInput): EquipmentSections {
  const c: Ctx = { ...input, rowMeta: new Map(), sectionMeta: new Map() };
  const catIds = input.categories.map((cat) => `cat-${cat.id}`);
  const sections = input.categories.flatMap((cat) => categorySections(cat, catIds, c));
  if (input.categories.length > 0) sections.push(...uncategorisedSections(c));
  else if (input.uncategorizedItems.length + input.orphanProjectGroups.length + input.orphanSubHireGroups.length > 0) {
    sections.push(...uncategorisedSections(c));
  }
  return { sections, rowMeta: c.rowMeta, sectionMeta: c.sectionMeta };
}

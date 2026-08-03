"use client";

import { useState } from "react";
import { Boxes, ChevronRight, Handshake } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useProjectVersion } from "@/components/projects/project-version-context";
import {
  reconstructProjectCategories,
  reconstructUncategorizedLineItems,
  reconstructUncategorizedSubHireGroups,
  reconstructUncategorizedProjectGroups,
  type EquipmentTabBundleData,
} from "@/lib/equipment-tab-reconstruct";
import type { CategoryData, GroupData, LineItemData, SubHireGroupData, MixedGroupSlot } from "@/components/projects/equipment-row-types";

/**
 * Read-only projection of the Equipment tab for a non-live version
 * (#1080/#1101, "Phase 6" — FEATUREDOCS/70). Fed by `ProjectVersionContext`'s
 * `equipmentBundle` — `convex/projectVersionsEquipment.ts`'s bundle-assembly
 * query, run through the SAME `reconstructProjectCategories`/
 * `reconstructUncategorized*` functions (`@/lib/equipment-tab-reconstruct`)
 * the LIVE Equipment tab uses for its own bundle, so a version's `mixedGroups`
 * ordering (project groups + sub-hire groups + standalone items, interleaved
 * by `categorySlots`) is byte-for-byte the same algorithm, not a second
 * hand-written shape (R-3.1).
 *
 * Structurally mirrors `equipment-tab.tsx`'s desktop table ONE continuous
 * `<table>` for every category + Uncategorized (not a card per category —
 * that was this component's first pass, and it's why v1/v2 looked visibly
 * different: category names as in-table header rows, same `colgroup`/column
 * widths, groups/sub-hire groups collapsible and COLLAPSED BY DEFAULT
 * (`expandedGroups` empty on mount), same as the live tab's own default.
 * Collapse state is local, view-only React state — toggling it never touches
 * data, so it's fine even though nothing else here is editable.
 *
 * This is NOT `equipment-tab.tsx`'s row components (`GroupRow`/`LineItemRow`/
 * `SubHireGroupRow`/`CategoryRow`) — those require several mutation callbacks
 * (onEdit/onDelete/onToggle/onAddEquipment/...) that aren't optional, and
 * `LineItemRow` unconditionally subscribes to LIVE collaboration comment
 * counts keyed by the current item id, which would be actively wrong here (a
 * comment count sourced from "now" on a row from three versions ago). This
 * renders the SAME data (`CategoryData`/`GroupData`/`SubHireGroupData`/
 * `LineItemData`) and the same `mixedGroups` order through markup styled to
 * match those components' classes, with zero editing affordances (no
 * buttons, no drag, no inline edit, no per-row badges beyond "Custom" — kit/
 * subhire/sale/prep badges need asset/unit data this view doesn't have, see
 * the bundle query's own scope note).
 *
 * `units` (per-serial fulfillment) and live availability/warehouse status are
 * still not shown, on purpose — see the file's own bundle query for why.
 */

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function groupTotal(g: GroupData): number {
  const price = g.price != null ? num(g.price) : null;
  if (price == null) return 0;
  return Math.max(0, price * g.quantity - num(g.discount));
}

/** Toggle set for group/sub-hire-group collapse state — empty by default
 *  (everything collapsed on first render), mirroring `equipment-tab.tsx`'s
 *  own `expandedGroups` Set. */
function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { isExpanded: (id: string) => expanded.has(id), toggle };
}

function LineRow({ item, indent }: { item: LineItemData; indent?: string }) {
  const total = item.lineTotal != null ? num(item.lineTotal) : num(item.unitPrice) * item.quantity;
  return (
    <>
      <TableRow>
        <TableCell className={indent}>
          <span className="truncate">{item.description || "Untitled item"}</span>
          {item.isCustomItem && (
            <Badge status="neutral" className="ml-2 align-middle">
              Custom
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-center t-data">{item.quantity}</TableCell>
        <TableCell className="text-right whitespace-nowrap t-data">{formatCurrency(num(item.unitPrice))}</TableCell>
        <TableCell className="text-right font-medium whitespace-nowrap t-data">{formatCurrency(total)}</TableCell>
      </TableRow>
      {item.childLineItems?.map((child) => <LineRow key={child.id} item={child} indent="pl-8" />)}
    </>
  );
}

function GroupRows({ group, isExpanded, onToggle }: { group: GroupData; isExpanded: boolean; onToggle: () => void }) {
  const items = group.lineItems ?? [];
  return (
    <>
      <TableRow>
        <TableCell>
          <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left">
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted transition-transform", isExpanded && "rotate-90")} />
            <span className="font-semibold">{group.title || "Untitled group"}</span>
          </button>
        </TableCell>
        <TableCell className="text-center t-data">{group.quantity}</TableCell>
        <TableCell className="text-right whitespace-nowrap t-data text-faint">—</TableCell>
        <TableCell className="text-right font-medium whitespace-nowrap t-data">{formatCurrency(groupTotal(group))}</TableCell>
      </TableRow>
      {isExpanded && items.map((li) => <LineRow key={li.id} item={li} indent="pl-8" />)}
    </>
  );
}

function SubHireGroupRows({ group, isExpanded, onToggle }: { group: SubHireGroupData; isExpanded: boolean; onToggle: () => void }) {
  const items = group.items ?? [];
  return (
    <>
      <TableRow>
        <TableCell>
          <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left">
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted transition-transform", isExpanded && "rotate-90")} />
            <Handshake className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <span className="font-semibold">{group.title || "Untitled sub-hire group"}</span>
          </button>
          <p className="mt-0.5 pl-[22px] text-caption text-muted">
            {group.subHire.supplier?.name ?? "Unknown supplier"} · {group.subHire.orderNumber}
          </p>
        </TableCell>
        <TableCell className="text-center t-data">{group.quantity}</TableCell>
        <TableCell className="text-right whitespace-nowrap t-data text-faint">—</TableCell>
        <TableCell className="text-right font-medium whitespace-nowrap t-data">{formatCurrency(num(group.charge))}</TableCell>
      </TableRow>
      {isExpanded &&
        items.map((it) => (
          <TableRow key={it.id}>
            <TableCell className="pl-8">{it.description || "Untitled item"}</TableCell>
            <TableCell className="text-center t-data">{it.quantity}</TableCell>
            <TableCell className="text-right whitespace-nowrap t-data">{formatCurrency(num(it.unitCharge))}</TableCell>
            <TableCell className="text-right font-medium whitespace-nowrap t-data">{formatCurrency(num(it.unitCharge) * it.quantity)}</TableCell>
          </TableRow>
        ))}
    </>
  );
}

/** Category name as an in-table header row — matches `CategoryRow`'s desktop
 *  classes (`bg-paper-2/50`, `t-overline text-muted`) rather than a card
 *  heading, since the live tab renders every category inside ONE table, not
 *  one table per category. */
function CategoryHeaderRow({ name }: { name: string }) {
  return (
    <TableRow className="border-b-0 bg-paper-2/50 hover:bg-paper-2/50">
      <TableCell colSpan={4} className="py-2 t-overline text-muted">
        {name || "Untitled category"}
      </TableCell>
    </TableRow>
  );
}

/** Walks a category's `mixedGroups` (the `categorySlots`-driven combined
 *  order) and renders each slot by kind — the same order the live tab's own
 *  walk produces, just without the Sortable/dnd-kit wrapping. */
function CategoryRows({
  category,
  isExpanded,
  toggle,
}: {
  category: CategoryData;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  const slots: MixedGroupSlot[] = category.mixedGroups ?? [];
  const groupById = new Map((category.groups ?? []).map((g) => [g.id, g]));
  const subHireGroupById = new Map((category.subHireGroupTargets ?? []).map((g) => [g.id, g]));
  const lineItemById = new Map((category.lineItems ?? []).map((li) => [li.id, li]));

  return (
    <>
      <CategoryHeaderRow name={category.name} />
      {slots.length === 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="py-3 text-center text-caption text-muted">
            No equipment in this category.
          </TableCell>
        </TableRow>
      )}
      {slots.map((slot) => {
        if (slot.kind === "project") {
          const g = groupById.get(slot.projectGroupId);
          return g ? <GroupRows key={`g-${g.id}`} group={g} isExpanded={isExpanded(g.id)} onToggle={() => toggle(g.id)} /> : null;
        }
        if (slot.kind === "subHire") {
          const sg = subHireGroupById.get(slot.subHireGroupId);
          return sg ? <SubHireGroupRows key={`sh-${sg.id}`} group={sg} isExpanded={isExpanded(sg.id)} onToggle={() => toggle(sg.id)} /> : null;
        }
        const li = lineItemById.get(slot.lineItemId);
        return li ? <LineRow key={`li-${li.id}`} item={li} /> : null;
      })}
    </>
  );
}

/** The "Uncategorized" bucket — groups, sub-hire groups and standalone items
 *  that belong to no category. Unlike a category's `mixedGroups`, these three
 *  are NOT `categorySlots`-interleaved (that table is scoped by
 *  `projectCategoryId`, which none of these have) — same sequential
 *  groups-then-items convention the live tab uses for this bucket. */
function UncategorizedRows({
  groups,
  subHireGroups,
  lineItems,
  isExpanded,
  toggle,
}: {
  groups: GroupData[];
  subHireGroups: SubHireGroupData[];
  lineItems: LineItemData[];
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  if (groups.length === 0 && subHireGroups.length === 0 && lineItems.length === 0) return null;
  return (
    <>
      <CategoryHeaderRow name="Uncategorized" />
      {groups.map((g) => (
        <GroupRows key={`g-${g.id}`} group={g} isExpanded={isExpanded(g.id)} onToggle={() => toggle(g.id)} />
      ))}
      {subHireGroups.map((sg) => (
        <SubHireGroupRows key={`sh-${sg.id}`} group={sg} isExpanded={isExpanded(sg.id)} onToggle={() => toggle(sg.id)} />
      ))}
      {lineItems.map((li) => (
        <LineRow key={`li-${li.id}`} item={li} />
      ))}
    </>
  );
}

function LoadingState({ viewingRevision }: { viewingRevision: number | null }) {
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">
      Loading v{viewingRevision}…
    </div>
  );
}

function NoBundleState({ viewingRevision }: { viewingRevision: number | null }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--r)] border border-line bg-card px-3 py-2 text-caption text-muted">
      <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>No equipment captured for v{viewingRevision}.</span>
    </div>
  );
}

function EmptyState({ viewingRevision }: { viewingRevision: number | null }) {
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">
      No equipment captured for v{viewingRevision}.
    </div>
  );
}

export function VersionProjectedEquipment() {
  const { isLoadingProjection, viewingRevision, equipmentBundle, isLoadingEquipmentBundle } = useProjectVersion();
  const { isExpanded, toggle } = useExpanded();

  if (isLoadingProjection || isLoadingEquipmentBundle) return <LoadingState viewingRevision={viewingRevision} />;
  if (!equipmentBundle) return <NoBundleState viewingRevision={viewingRevision} />;

  const bundle = equipmentBundle as unknown as EquipmentTabBundleData;
  const categories = reconstructProjectCategories(bundle);
  const uncategorizedLineItems = reconstructUncategorizedLineItems(bundle);
  const uncategorizedSubHireGroups = reconstructUncategorizedSubHireGroups(bundle);
  const uncategorizedProjectGroups = reconstructUncategorizedProjectGroups(bundle);
  const isEmpty =
    categories.length === 0 &&
    uncategorizedLineItems.length === 0 &&
    uncategorizedSubHireGroups.length === 0 &&
    uncategorizedProjectGroups.length === 0;

  if (isEmpty) return <EmptyState viewingRevision={viewingRevision} />;

  return (
    <div className="overflow-x-auto rounded-[var(--r)] border border-line">
      <table className="w-full caption-bottom text-[13.5px] table-fixed">
        <colgroup>
          <col />
          <col className="w-16" />
          <col className="w-28" />
          <col className="w-28" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-center">Qty</TableHead>
            <TableHead className="text-right whitespace-nowrap">Unit price</TableHead>
            <TableHead className="text-right whitespace-nowrap">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((c) => (
            <CategoryRows key={c.id} category={c} isExpanded={isExpanded} toggle={toggle} />
          ))}
          <UncategorizedRows
            groups={uncategorizedProjectGroups}
            subHireGroups={uncategorizedSubHireGroups}
            lineItems={uncategorizedLineItems}
            isExpanded={isExpanded}
            toggle={toggle}
          />
        </TableBody>
      </table>
    </div>
  );
}

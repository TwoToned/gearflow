"use client";

import { Boxes, Handshake } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
 * This is NOT `equipment-tab.tsx`'s row components (`GroupRow`/`LineItemRow`/
 * `SubHireGroupRow`) — those require several mutation callbacks (onEdit/
 * onDelete/onToggle/onAddEquipment/...) that aren't optional, and unconditionally
 * subscribe to LIVE collaboration comment counts keyed by the current item id,
 * which would be actively wrong here (a comment count sourced from "now" on a
 * row from three versions ago). This renders the SAME data
 * (`CategoryData`/`GroupData`/`SubHireGroupData`/`LineItemData`) and the same
 * `mixedGroups` order through genuinely static markup instead — visually
 * matching the live table's columns/grouping/totals, with zero editing
 * affordances (no buttons, no drag, no inline edit) since nothing here is
 * live to edit.
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

function LineRow({ item, indent }: { item: LineItemData; indent?: boolean }) {
  const total = item.lineTotal != null ? num(item.lineTotal) : num(item.unitPrice) * item.quantity;
  return (
    <>
      <TableRow>
        <TableCell className={cn(indent && "pl-8")}>
          <span className="truncate">{item.description || "Untitled item"}</span>
          {item.isCustomItem && (
            <Badge status="neutral" className="ml-2 align-middle">
              Custom
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
        <TableCell className="text-right tabular-nums">{formatCurrency(num(item.unitPrice))}</TableCell>
        <TableCell className="text-right tabular-nums">{formatCurrency(total)}</TableCell>
      </TableRow>
      {item.childLineItems?.map((child) => <LineRow key={child.id} item={child} indent />)}
    </>
  );
}

function GroupRows({ group }: { group: GroupData }) {
  return (
    <>
      <TableRow className="bg-card-2">
        <TableCell className="font-semibold">{group.title || "Untitled group"}</TableCell>
        <TableCell className="text-center tabular-nums">{group.quantity}</TableCell>
        <TableCell className="text-right">—</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(groupTotal(group))}</TableCell>
      </TableRow>
      {(group.lineItems ?? []).map((li) => (
        <LineRow key={li.id} item={li} indent />
      ))}
    </>
  );
}

function SubHireGroupRows({ group }: { group: SubHireGroupData }) {
  return (
    <>
      <TableRow className="bg-card-2">
        <TableCell className="font-semibold">
          <span className="inline-flex items-center gap-1.5">
            <Handshake className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            {group.title || "Untitled sub-hire group"}
            <Badge status="neutral">Sub-hire</Badge>
          </span>
          <span className="mt-0.5 block text-caption text-muted">
            {group.subHire.supplier?.name ?? "Unknown supplier"} · {group.subHire.orderNumber}
          </span>
        </TableCell>
        <TableCell className="text-center tabular-nums">{group.quantity}</TableCell>
        <TableCell className="text-right">—</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(num(group.charge))}</TableCell>
      </TableRow>
      {(group.items ?? []).map((it) => (
        <TableRow key={it.id}>
          <TableCell className="pl-8">{it.description || "Untitled item"}</TableCell>
          <TableCell className="text-center tabular-nums">{it.quantity}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(num(it.unitCharge))}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(num(it.unitCharge) * it.quantity)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

/** Walks a category's `mixedGroups` (the `categorySlots`-driven combined
 *  order) and renders each slot by kind — the same order the live tab's own
 *  walk produces, just without the Sortable/dnd-kit wrapping. */
function CategoryBlock({ category }: { category: CategoryData }) {
  const slots: MixedGroupSlot[] = category.mixedGroups ?? [];
  const groupById = new Map((category.groups ?? []).map((g) => [g.id, g]));
  const subHireGroupById = new Map((category.subHireGroupTargets ?? []).map((g) => [g.id, g]));
  const lineItemById = new Map((category.lineItems ?? []).map((li) => [li.id, li]));
  const isEmpty = slots.length === 0;

  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
      <h3 className="text-card-title font-bold text-ink">{category.name || "Untitled category"}</h3>
      {isEmpty ? (
        <p className="mt-2 text-caption text-muted">No equipment in this category.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-[var(--r)] border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((slot) => {
                if (slot.kind === "project") {
                  const g = groupById.get(slot.projectGroupId);
                  return g ? <GroupRows key={`g-${g.id}`} group={g} /> : null;
                }
                if (slot.kind === "subHire") {
                  const sg = subHireGroupById.get(slot.subHireGroupId);
                  return sg ? <SubHireGroupRows key={`sh-${sg.id}`} group={sg} /> : null;
                }
                const li = lineItemById.get(slot.lineItemId);
                return li ? <LineRow key={`li-${li.id}`} item={li} /> : null;
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** The "Uncategorized" bucket — groups, sub-hire groups and standalone items
 *  that belong to no category. Unlike a category's `mixedGroups`, these three
 *  are NOT `categorySlots`-interleaved (that table is scoped by
 *  `projectCategoryId`, which none of these have) — same sequential
 *  groups-then-items convention the live tab uses for this bucket. */
function UncategorizedBlock({
  groups,
  subHireGroups,
  lineItems,
}: {
  groups: GroupData[];
  subHireGroups: SubHireGroupData[];
  lineItems: LineItemData[];
}) {
  if (groups.length === 0 && subHireGroups.length === 0 && lineItems.length === 0) return null;
  return (
    <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4">
      <h3 className="text-card-title font-bold text-ink">Uncategorized</h3>
      <div className="mt-2 overflow-hidden rounded-[var(--r)] border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <GroupRows key={`g-${g.id}`} group={g} />
            ))}
            {subHireGroups.map((sg) => (
              <SubHireGroupRows key={`sh-${sg.id}`} group={sg} />
            ))}
            {lineItems.map((li) => (
              <LineRow key={`li-${li.id}`} item={li} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function VersionProjectedEquipment() {
  const { isLoadingProjection, viewingRevision, equipmentBundle, isLoadingEquipmentBundle } = useProjectVersion();

  if (isLoadingProjection || isLoadingEquipmentBundle) {
    return <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">Loading v{viewingRevision}…</div>;
  }
  if (!equipmentBundle) {
    return (
      <div className="flex items-start gap-2 rounded-[var(--r)] border border-line bg-card px-3 py-2 text-caption text-muted">
        <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>No equipment captured for v{viewingRevision}.</span>
      </div>
    );
  }

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

  if (isEmpty) {
    return (
      <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-6 text-center text-muted">
        No equipment captured for v{viewingRevision}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {categories.map((c) => (
        <CategoryBlock key={c.id} category={c} />
      ))}
      <UncategorizedBlock
        groups={uncategorizedProjectGroups}
        subHireGroups={uncategorizedSubHireGroups}
        lineItems={uncategorizedLineItems}
      />
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { usePackingTab, type PackingTabData, type RealContainer } from "@/hooks/use-packing-tab";
import { usePackingCaseWrites } from "@/hooks/use-packing-case-writes";
import { usePackingPlan } from "@/hooks/use-packing-plan";
import { usePackingSelection } from "@/hooks/use-packing-selection";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCanDo } from "@/lib/use-permissions";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import { openLabel } from "@/components/documents/label-submenu";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { BulkBar, PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import {
  NO_PACKING_FILTERS,
  buildPackingBuckets,
  canDragLine,
  filterPlannableLines,
  packingFiltersActive,
  packingFooterFacts,
  plannedCaseOf,
  type PlannableLine,
} from "@/lib/packing-tab";
import { buildPackingBulkActions, buildPackingLineActions } from "@/lib/row-actions/packing-line";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { PackingBoard, type CaseBucket } from "./packing/packing-board";
import { buildCaseMenu, type CaseRef } from "./packing/case-menu";
import { PackingDndProvider, type DropTarget } from "./packing/packing-dnd";
import { PackingLineRow } from "./packing/packing-line-row";
import { PackingToolbar } from "./packing/packing-toolbar";
import { RenameCaseDialog } from "./rename-case-dialog";
import { UNPLANNED_LABEL } from "@/lib/vocabulary";

export interface PackingTabProps {
  projectId: string;
  orgId: string | undefined;
  versionId?: string;
}

/**
 * The job's Packing tab (§7b, D19-D21): plan which case each piece of gear
 * travels in before the warehouse starts prepping. `plannedContainerId` (the
 * PM's intent) and the unit's real `containerId` (the warehouse's reality)
 * answer different questions (`resolvePackingStatus`): a packed line shows
 * `● Packed` and cannot be moved here, and says `Planned → LX-04` only when
 * the plan disagrees with where it actually is.
 *
 * ONE write: `usePackingPlan().planInto(ids, case | null)`. Dragging a row (a
 * ticked row drags the whole selection), the bulk `Plan n into…` and the row ⋯
 * `Plan into…` all call it, so they share what it skips and its single Undo.
 * A sealed case (D21) refuses drops client-side with a toast naming Unseal; the
 * server is the authority and refuses the same writes (`CASE_SEALED`).
 */
export function PackingTab({ projectId, orgId, versionId }: PackingTabProps) {
  const data = usePackingTab(projectId, orgId, versionId);
  if (data.isLoading) return null;
  if (data.totalCount === 0) {
    return (
      <EmptyState
        title="Nothing to plan yet"
        description="Add equipment on the Equipment tab, then come back here to decide which container it travels in."
      />
    );
  }
  return <PackingBody projectId={projectId} versionId={versionId} data={data} />;
}

function PackingBody({ projectId, versionId, data }: { projectId: string; versionId?: string; data: PackingTabData }) {
  const { lines, containers } = data;
  const router = useRouter();
  const isMobile = useIsMobile();
  const canManage = useCanDo("project", "manage_line_items");
  const caseWrites = usePackingCaseWrites(projectId);
  const { planInto } = usePackingPlan(lines, containers);

  const [filters, setFilters] = useState(NO_PACKING_FILTERS);
  const [expandAll, setExpandAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<CaseRef | null>(null);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const labelById = useMemo(() => new Map(containers.map((c) => [c.id, c.label])), [containers]);
  const caseRefs = useMemo(() => containers.map((c) => ({ id: c.id, label: c.label, sealed: c.sealedAt != null })), [containers]);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.item.id, l.item])), [lines]);
  const categories = useMemo(() => [...new Set(lines.map((l) => l.categoryName))].sort((a, b) => a.localeCompare(b)), [lines]);

  const active = packingFiltersActive(filters);
  const filtered = useMemo(() => filterPlannableLines(lines, filters), [lines, filters]);
  const buckets = useMemo(
    () => buildPackingBuckets(filtered, labelById, active ? [] : containers.map((c) => c.id)),
    [filtered, labelById, containers, active],
  );
  const unplanned = useMemo(() => buckets.find((b) => b.containerId === null)?.lines ?? [], [buckets]);
  const caseBuckets = useMemo(() => buckets.filter((b): b is CaseBucket => b.containerId !== null), [buckets]);
  const orderedIds = useMemo(() => [...unplanned, ...caseBuckets.flatMap((b) => b.lines)].map((l) => l.item.id), [unplanned, caseBuckets]);
  const selection = usePackingSelection(orderedIds);

  /** A line can move only while nothing of it is packed and its case is open. */
  const canMove = useCallback(
    (id: string) => {
      const item = lineById.get(id);
      return !!item && canDragLine(item) && !plannedCaseOf(item, containers)?.sealed;
    },
    [lineById, containers],
  );

  const canUnplan = [...selection.selected].some((id) => lineById.get(id)?.plannedContainerId);

  const planSelected = (target: CaseRef | null) => {
    void planInto([...selection.selected], target).then((r) => r && selection.clear());
  };

  const dropTargets: DropTarget[] = [{ id: null, label: UNPLANNED_LABEL, sealed: false }, ...caseRefs];

  const renderRow = ({ item, categoryName }: PlannableLine) => {
    const menu: ActionMenuSpec = canManage
      ? buildPackingLineActions(
          { id: item.id, canPlan: canDragLine(item), plannedCase: plannedCaseOf(item, containers) },
          { cases: caseRefs, onPlanInto: (id, label) => void planInto([item.id], id ? { id, label: label ?? "" } : null) },
        )
      : { items: [] };
    return (
      <PackingLineRow
        key={item.id}
        item={item}
        categoryName={categoryName}
        labelById={labelById}
        selected={selection.selected.has(item.id)}
        onToggle={({ range }) => selection.toggle(item.id, { range })}
        canDrag={canManage && canMove(item.id)}
        selectable={!plannedCaseOf(item, containers)?.sealed}
        menu={menu}
      />
    );
  };

  const caseMenu = (bucket: CaseBucket, expanded: boolean, setExpanded: (on: boolean) => void): ActionMenuSpec | undefined =>
    canManage ? buildCaseMenu({ bucket, expanded, setExpanded, containers, caseWrites, planInto, onRename: setRenaming }) : undefined;

  const tabMenu: ActionMenuSpec = {
    items: [
      { key: "print-labels", label: "Print all case labels", group: "documents", onSelect: () => void openLabel(projectId, "container-label") },
      { key: "manifest", label: "Manifest", group: "documents", onSelect: () => void window.open(`/api/documents/${projectId}?type=manifest`, "_blank") },
      {
        key: "select-unplanned",
        label: "Select the unplanned",
        group: "organise",
        onSelect: () => selection.replace(unplanned.filter((l) => canMove(l.item.id)).map((l) => l.item.id)),
      },
      { key: "expand-all", label: expandAll ? "Show fewer lines" : "Show every line", group: "organise", onSelect: () => setExpandAll((v) => !v) },
      { key: "warehouse", label: "Open the warehouse page", group: "organise", onSelect: () => router.push(`/warehouse/${projectId}`) },
    ],
  };

  const footer = packingFooterFacts(lines);
  const nothingMatches = active && filtered.length === 0;

  return (
    <div className={isMobile ? "space-y-4 pb-24" : "space-y-4"}>
      <PackingToolbar
        filters={filters}
        onFilters={setFilters}
        categories={categories}
        tabMenu={tabMenu}
        onAddCase={canManage && !isMobile ? () => setNewCaseOpen(true) : undefined}
      />

      <PackingDndProvider
        selected={selection.selected}
        canDrag={canMove}
        targets={dropTargets}
        onDrop={(plan) => {
          if (plan.kind === "refused") toast.error(plan.message);
          else void planInto(plan.ids, plan.target).then((r) => r && selection.clear());
        }}
      >
        {nothingMatches ? (
          <EmptyState title="No lines match that" description="Clear the search or a filter to see every line." />
        ) : (
          <PackingBoard
            unplanned={unplanned}
            cases={caseBuckets}
            containers={containers}
            selected={selection.selected}
            onGroupSelect={selection.setGroup}
            renderRow={renderRow}
            caseMenu={caseMenu}
            expandAll={expandAll}
            expandedIds={expandedIds}
            onExpandedChange={(id, on) =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            unplannedEmptyText={active ? "No lines match that" : "Every line has a case"}
          />
        )}
      </PackingDndProvider>

      <p className="t-mono text-muted">
        {footer.lines} {footer.lines === 1 ? "line" : "lines"} · {footer.units} {footer.units === 1 ? "unit" : "units"} · {footer.packed} packed in the warehouse
      </p>

      {canManage && selection.count > 0 && (
        <BulkBar
          selection={selection}
          noun="line"
          actions={buildPackingBulkActions({ cases: caseRefs, canUnplan, onPlanInto: (id, label) => planSelected(id ? { id, label: label ?? "" } : null) })}
        />
      )}
      {isMobile && canManage && selection.count === 0 && (
        <PinnedAboveBottomNav>
          <Button className="w-full" onClick={() => setNewCaseOpen(true)}>
            <Plus className="h-4 w-4" />
            Add case
          </Button>
        </PinnedAboveBottomNav>
      )}

      <RenameCaseDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(id, label) => {
          if (renaming && renaming.id === id) void caseWrites.rename(renaming, label);
        }}
      />
      <NewContainerSheet
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        projectId={projectId}
        versionId={versionId}
        existingContainers={caseRefs}
        onCreated={() => setNewCaseOpen(false)}
      />
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { usePackingTab, type RealContainer } from "@/hooks/use-packing-tab";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { usePackingCaseWrites } from "@/hooks/use-packing-case-writes";
import { useCanDo } from "@/lib/use-permissions";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import type { PackingContainerBucket } from "@/lib/packing-tab";
import { resolvePackingStatus, caseCardFacts, caseAndDescendantIds } from "@/lib/packing-tab";
import { buildPackingCaseActions } from "@/lib/row-actions/packing-case";
import { PackingCaseCard } from "./packing-case-card";
import { RenameCaseDialog } from "./rename-case-dialog";
import type { LineItemData } from "@/components/projects/equipment-rows";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { focusRing, cn } from "@/lib/utils";
import { LOOSE_LABEL } from "@/lib/vocabulary";

export interface PackingTabProps {
  projectId: string;
  orgId: string | undefined;
  versionId?: string;
}

const NOT_PLANNED_VALUE = "";

function lineDisplayName(item: LineItemData): string {
  if (item.kitId) return item.kit?.name ?? item.description ?? "Kit";
  return item.model?.name ?? item.description ?? "—";
}

function PlanStatusBadge({ item }: { item: LineItemData }) {
  const status = resolvePackingStatus(item);
  if (status.kind === "packed") return <Badge status="ok">Packed</Badge>;
  if (status.kind === "planned") return <Badge status="neutral" className="italic">Planned</Badge>;
  return null;
}

function PlanLineRow({
  item,
  categoryName,
  containers,
  onSetContainer,
}: {
  item: LineItemData;
  categoryName: string;
  containers: { id: string; label: string }[];
  onSetContainer: (lineItemId: string, containerId: string | null) => void;
}) {
  const status = resolvePackingStatus(item);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-ui-text text-ink">{lineDisplayName(item)}</span>
          <PlanStatusBadge item={item} />
        </div>
        <span className="text-caption text-muted">{categoryName} · Qty {item.quantity}</span>
      </div>
      <select
        aria-label={`Container for ${lineDisplayName(item)}`}
        value={status.kind === "packed" ? "" : (item.plannedContainerId ?? NOT_PLANNED_VALUE)}
        disabled={status.kind === "packed"}
        onChange={(e) => onSetContainer(item.id, e.target.value || null)}
        className={cn(
          "h-9 rounded-[var(--r)] border border-line bg-transparent px-2 text-ui-text text-ink disabled:opacity-60",
          focusRing,
        )}
      >
        <option value={NOT_PLANNED_VALUE}>{LOOSE_LABEL}</option>
        {containers.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </div>
  );
}

function PackingToolbar({
  notPlannedCount,
  totalCount,
  onNewContainer,
}: {
  notPlannedCount: number;
  totalCount: number;
  onNewContainer: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-ui-text text-muted">
        {notPlannedCount > 0
          ? `${notPlannedCount} of ${totalCount} lines not planned yet`
          : "Every line has a container planned"}
      </p>
      <button
        type="button"
        onClick={onNewContainer}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-[var(--r)] border border-dashed border-line px-3 text-ui-text font-medium text-muted hover:bg-elev hover:text-ink",
          focusRing,
        )}
      >
        <Plus className="h-4 w-4" />
        New container
      </button>
    </div>
  );
}

function BucketLines({
  bucket,
  containers,
  onSetContainer,
}: {
  bucket: PackingContainerBucket;
  containers: { id: string; label: string }[];
  onSetContainer: (lineItemId: string, containerId: string | null) => void;
}) {
  return (
    <>
      {bucket.lines.map(({ item, categoryName }) => (
        <PlanLineRow key={item.id} item={item} categoryName={categoryName} containers={containers} onSetContainer={onSetContainer} />
      ))}
    </>
  );
}

/** The Loose bucket: lines with no case planned. Not a case, so no ⋯. */
function LooseSection({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line overflow-hidden">
      <div className="flex items-center gap-1.5 bg-paper-2/60 px-3 py-2 text-caption font-semibold text-ink-2">
        <Package className="h-3.5 w-3.5" />
        {LOOSE_LABEL}
        <Badge status="neutral" className="ml-auto tabular-nums">{count}</Badge>
      </div>
      {children}
    </div>
  );
}

type CaseWrites = ReturnType<typeof usePackingCaseWrites>;
type CaseRef = { id: string; label: string };

/** This case's container row, its display ref, and the case it sits inside. */
function caseRelations(bucket: PackingContainerBucket & { containerId: string }, containers: RealContainer[]) {
  const me = containers.find((c) => c.id === bucket.containerId);
  const self: CaseRef = { id: bucket.containerId, label: bucket.label ?? me?.label ?? "Case" };
  const parentDoc = me?.parentContainerId ? containers.find((c) => c.id === me.parentContainerId) : undefined;
  const parent: CaseRef | null = parentDoc ? { id: parentDoc.id, label: parentDoc.label } : null;
  return { me, self, parent };
}

/** The case ⋯: "Move into" lists every other case except this one's own
 *  descendants and its current parent (the server's cycle check is the authority). */
function caseMenu({
  self,
  parent,
  facts,
  containers,
  caseWrites,
  onRename,
}: {
  self: CaseRef;
  parent: CaseRef | null;
  facts: ReturnType<typeof caseCardFacts>;
  containers: RealContainer[];
  caseWrites: CaseWrites;
  onRename: (c: CaseRef) => void;
}) {
  const excluded = caseAndDescendantIds(containers, self.id);
  const moveTargets = containers.filter((c) => !excluded.has(c.id) && c.id !== parent?.id).map((c) => ({ id: c.id, label: c.label }));
  return buildPackingCaseActions(
    { id: self.id, label: self.label, parent, plannedOnlyCount: facts.plannedOnlyIds.length },
    {
      moveTargets,
      onRename: () => onRename(self),
      onMoveInto: (targetId) => {
        const target = moveTargets.find((c) => c.id === targetId);
        if (target) void caseWrites.moveInto(self, target, parent);
      },
      onTakeOut: parent ? () => void caseWrites.takeOut(self, parent) : undefined,
      onUnpack: () => void caseWrites.unpack(self, facts.plannedOnlyIds, facts.packedCount),
    },
  );
}

/** One case's card: header facts, the ⋯ built by `buildPackingCaseActions`. */
function CaseSection({
  bucket,
  containers,
  canManage,
  caseWrites,
  onRename,
  onSetContainer,
}: {
  bucket: PackingContainerBucket & { containerId: string };
  containers: RealContainer[];
  canManage: boolean;
  caseWrites: CaseWrites;
  onRename: (c: { id: string; label: string }) => void;
  onSetContainer: (lineItemId: string, containerId: string | null) => void;
}) {
  const { me, self, parent } = caseRelations(bucket, containers);
  const facts = caseCardFacts(bucket);
  const menu = canManage ? caseMenu({ self, parent, facts, containers, caseWrites, onRename }) : undefined;
  return (
    <PackingCaseCard
      label={self.label}
      kind={me?.kind}
      parentLabel={parent?.label}
      lineCount={facts.lineCount}
      packedCount={facts.packedCount}
      menu={menu}
    >
      <BucketLines bucket={bucket} containers={containers} onSetContainer={onSetContainer} />
    </PackingCaseCard>
  );
}

/** Every case card (empty cases included), then Loose; owns the case verbs
 *  and the rename dialog. */
function PackingBuckets({
  buckets,
  containers,
  onSetContainer,
}: {
  buckets: PackingContainerBucket[];
  containers: RealContainer[];
  onSetContainer: (lineItemId: string, containerId: string | null) => void;
}) {
  const caseWrites = usePackingCaseWrites();
  const canManage = useCanDo("project", "manage_line_items");
  const [renaming, setRenaming] = useState<CaseRef | null>(null);
  return (
    <div className="space-y-3">
      {buckets.map((bucket) =>
        bucket.containerId === null ? (
          <LooseSection key="__not_planned" count={bucket.lines.length}>
            <BucketLines bucket={bucket} containers={containers} onSetContainer={onSetContainer} />
          </LooseSection>
        ) : (
          <CaseSection
            key={bucket.containerId}
            bucket={{ ...bucket, containerId: bucket.containerId }}
            containers={containers}
            canManage={canManage}
            caseWrites={caseWrites}
            onRename={setRenaming}
            onSetContainer={onSetContainer}
          />
        ),
      )}
      <RenameCaseDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(id, label) => {
          if (renaming && renaming.id === id) void caseWrites.rename(renaming, label);
        }}
      />
    </div>
  );
}

/**
 * #1296 build plan phase 4, D11 — the project's own Packing tab: plan which
 * container each piece of gear travels in before the warehouse starts
 * prepping. `plannedContainerId` (PM's intent, set here) and the unit's real
 * `containerId` (physical reality, set in the warehouse) answer different
 * questions — see `resolvePackingStatus`. A line already physically packed
 * is read-only here (the warehouse is the source of truth once packing has
 * actually started; re-planning a packed line belongs in the warehouse's own
 * Move-to…, not here).
 *
 * D9 explicitly wants BOTH a plan (here) and the actual pack (warehouse);
 * dragging (the design doc's preferred interaction) is deferred — this ships
 * the same underlying effect (`setPlannedContainer`) via a plain per-row
 * picker instead, which needed no changes to the Equipment tab's own
 * (unrelated, much larger) drag-and-drop system to ship safely.
 */
export function PackingTab({ projectId, orgId, versionId }: PackingTabProps) {
  const { buckets, containers, notPlannedCount, totalCount, isLoading } = usePackingTab(projectId, orgId, versionId);
  const containerWrites = useProjectContainerWrites();
  const [newContainerSheetOpen, setNewContainerSheetOpen] = useState(false);

  const handleSetContainer = async (lineItemId: string, containerId: string | null) => {
    try {
      await containerWrites.setPlannedContainer([lineItemId], containerId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update the plan");
    }
  };

  if (isLoading) return null;

  if (totalCount === 0) {
    return (
      <EmptyState
        title="Nothing to plan yet"
        description="Add equipment on the Equipment tab, then come back here to decide which container it travels in."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PackingToolbar notPlannedCount={notPlannedCount} totalCount={totalCount} onNewContainer={() => setNewContainerSheetOpen(true)} />

      <PackingBuckets buckets={buckets} containers={containers} onSetContainer={handleSetContainer} />

      <NewContainerSheet
        open={newContainerSheetOpen}
        onOpenChange={setNewContainerSheetOpen}
        projectId={projectId}
        existingContainers={containers.map((c) => ({ id: c.id, label: c.label }))}
        onCreated={() => setNewContainerSheetOpen(false)}
      />
    </div>
  );
}

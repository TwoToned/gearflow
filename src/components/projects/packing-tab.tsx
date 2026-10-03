"use client";

import { useState } from "react";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { usePackingTab } from "@/hooks/use-packing-tab";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { NewContainerSheet } from "@/components/warehouse/new-container-sheet";
import type { PackingContainerBucket } from "@/lib/packing-tab";
import { resolvePackingStatus } from "@/lib/packing-tab";
import type { LineItemData } from "@/components/projects/equipment-rows";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { focusRing, cn } from "@/lib/utils";

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
        <option value={NOT_PLANNED_VALUE}>Not planned</option>
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

function BucketSection({
  bucket,
  containers,
  onSetContainer,
}: {
  bucket: PackingContainerBucket;
  containers: { id: string; label: string }[];
  onSetContainer: (lineItemId: string, containerId: string | null) => void;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line overflow-hidden">
      <div className="flex items-center gap-1.5 bg-paper-2/60 px-3 py-2 text-caption font-semibold text-ink-2">
        <Package className="h-3.5 w-3.5" />
        {bucket.label ?? "Not planned"}
        <Badge status="neutral" className="ml-auto tabular-nums">{bucket.lines.length}</Badge>
      </div>
      {bucket.lines.map(({ item, categoryName }) => (
        <PlanLineRow key={item.id} item={item} categoryName={categoryName} containers={containers} onSetContainer={onSetContainer} />
      ))}
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

      <div className="space-y-3">
        {buckets.map((bucket) => (
          <BucketSection
            key={bucket.containerId ?? "__not_planned"}
            bucket={bucket}
            containers={containers}
            onSetContainer={handleSetContainer}
          />
        ))}
      </div>

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

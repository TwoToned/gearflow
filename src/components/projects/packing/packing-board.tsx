"use client";

import type { ReactNode } from "react";
import type { RealContainer } from "@/hooks/use-packing-tab";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import type { PackingContainerBucket, PlannableLine } from "@/lib/packing-tab";
import { caseCardFacts } from "@/lib/packing-tab";
import { CaseCard } from "./case-card";
import { UnplannedCard } from "./unplanned-card";

export type CaseBucket = PackingContainerBucket & { containerId: string };

/** Header checkbox state for a group of line ids. */
function checkState(ids: readonly string[], selected: ReadonlySet<string>): boolean | "indeterminate" {
  const n = ids.filter((id) => selected.has(id)).length;
  if (n === 0) return false;
  return n === ids.length ? true : "indeterminate";
}

/**
 * The Packing layout (§7b.2): on desktop the Unplanned card sticks on the left
 * and the case cards run in two columns on the right; on a phone the Unplanned
 * card comes first and each case is a section under it (DOM order does both).
 * Pure rendering: every verb arrives as a prop from `PackingTab`.
 */
export function PackingBoard({
  unplanned,
  cases,
  containers,
  selected,
  onGroupSelect,
  renderRow,
  caseMenu,
  expandAll,
  expandedIds,
  onExpandedChange,
  unplannedEmptyText,
}: {
  unplanned: readonly PlannableLine[];
  cases: readonly CaseBucket[];
  containers: readonly RealContainer[];
  selected: ReadonlySet<string>;
  onGroupSelect: (ids: readonly string[], on: boolean) => void;
  renderRow: (line: PlannableLine) => ReactNode;
  caseMenu: (bucket: CaseBucket, expanded: boolean, setExpanded: (on: boolean) => void) => ActionMenuSpec | undefined;
  expandAll: boolean;
  expandedIds: ReadonlySet<string>;
  onExpandedChange: (caseId: string, on: boolean) => void;
  unplannedEmptyText: string;
}) {
  const unplannedIds = unplanned.map((l) => l.item.id);
  return (
    <div className="space-y-3 md:grid md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] md:items-start md:gap-4 md:space-y-0">
      <UnplannedCard
        count={unplanned.length}
        rows={unplanned.map((l) => renderRow(l))}
        checked={checkState(unplannedIds, selected)}
        onCheckedChange={(on) => onGroupSelect(unplannedIds, on)}
        emptyText={unplannedEmptyText}
      />
      <div className="grid gap-3 xl:grid-cols-2">
        {cases.map((bucket) => {
          const container = containers.find((c) => c.id === bucket.containerId);
          const parent = container?.parentContainerId ? containers.find((c) => c.id === container.parentContainerId) : undefined;
          const facts = caseCardFacts(bucket);
          const ids = bucket.lines.map((l) => l.item.id);
          const expanded = expandAll || expandedIds.has(bucket.containerId);
          const setExpanded = (on: boolean) => onExpandedChange(bucket.containerId, on);
          return (
            <CaseCard
              key={bucket.containerId}
              caseId={bucket.containerId}
              label={bucket.label ?? container?.label ?? "Case"}
              kind={container?.kind}
              parentLabel={parent?.label}
              sealed={container?.sealedAt != null}
              lineCount={facts.lineCount}
              packedCount={facts.packedCount}
              menu={caseMenu(bucket, expanded, setExpanded)}
              checked={checkState(ids, selected)}
              onCheckedChange={(on) => onGroupSelect(ids, on)}
              rows={bucket.lines.map((l) => renderRow(l))}
              expanded={expanded}
              onExpandedChange={setExpanded}
            />
          );
        })}
      </div>
    </div>
  );
}

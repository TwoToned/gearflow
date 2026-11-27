"use client";
// use-client: row selection state (R-8.1.1)

import * as React from "react";

import { BulkBar } from "@/components/ui/bulk-bar";
import { LineRowList } from "@/components/ui/line-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import type { BulkAction, FactColumn, LineRowData } from "@/lib/primitives/types";

/**
 * One Team list: a hairline section with a title and a mono count, rows on the
 * shared `LineRowList` (tick, shift-range, select-page, row ⋯), and a `BulkBar`
 * whose verbs are contextual to the KIND of row ticked (§9k.3). Selection is by
 * id, so it survives a refresh; ids that disappear are simply no longer ticked.
 */
export function TeamList({
  title,
  noun,
  rows,
  columns,
  itemHeader,
  bulkActions,
  loading,
  empty,
  action,
}: {
  title: string;
  noun: string;
  rows: LineRowData[];
  columns: FactColumn[];
  itemHeader: string;
  /** Receives the ticked ids; absent verbs are simply not offered. */
  bulkActions?: (ids: string[]) => BulkAction[];
  loading?: boolean;
  empty: string;
  action?: React.ReactNode;
}) {
  const ids = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const selection = useRowSelection(ids);
  const ticked = React.useMemo(() => ids.filter((id) => selection.isSelected(id)), [ids, selection]);
  const actions = bulkActions && ticked.length > 0 ? bulkActions(ticked) : [];

  return (
    <section aria-labelledby={`team-${noun}`} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`team-${noun}`} className="t-heading text-ink">
          {title} <span className="ml-1 font-mono text-table-cell font-normal tabular-nums text-muted">{rows.length}</span>
        </h2>
        {action}
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <p className="border-y border-line py-4 t-small text-muted">{empty}</p>
      ) : (
        <LineRowList rows={rows} columns={columns} itemHeader={itemHeader} selection={bulkActions ? selection : undefined} />
      )}
      {actions.length > 0 ? <BulkBar selection={selection} actions={actions} noun={noun} /> : null}
    </section>
  );
}

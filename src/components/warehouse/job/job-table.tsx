"use client";

import { useMemo } from "react";
import { LineRowList, visibleRowIds, type LineRowListSection } from "@/components/ui/line-row";
import type { ActionMenuSpec, FactColumn, RowFlag, RowSelection } from "@/lib/primitives/types";
import type { JobSection } from "@/lib/warehouse-job-rows";

/** Qty · case · (status is the row's own word). At most 8 columns (playbook §3.8). */
const JOB_COLUMNS: FactColumn[] = [
  { id: "place", header: "Case" },
  { id: "qty", header: "Qty", align: "end" },
];

/** The ids a page feeds `useRowSelection` (sections first, rows in DOM order). */
export function jobRowIds(sections: JobSection[]): string[] {
  return visibleRowIds(toListSections(sections, () => ({})));
}

function toListSections(
  sections: JobSection[],
  extra: (s: JobSection) => Partial<LineRowListSection["section"]>,
): LineRowListSection[] {
  return sections.map((s) => ({ section: { ...s.section, ...extra(s) }, rows: s.rows }));
}

/**
 * ONE table: category groups on To pick, case groups (Loose last) from
 * Prepped, each head carrying its tick-all box, flags and ⋯ (spec §9.2).
 */
export function JobTable({
  sections, selection, sectionMenu, sectionFlags,
}: {
  sections: JobSection[];
  selection: RowSelection;
  /** The case header ⋯ (seal, make active, print label, unpack, remove); category heads have none. */
  sectionMenu?: (s: JobSection) => ActionMenuSpec | undefined;
  /** `Sealed` / `Packing` / `Active` dot-words. */
  sectionFlags?: (s: JobSection) => RowFlag[];
}) {
  const list = useMemo(
    () =>
      toListSections(sections, (s) => {
        const ids = s.rows.map((r) => r.id);
        const ticked = ids.filter((id) => selection.isSelected(id)).length;
        return {
          menu: sectionMenu?.(s),
          flags: sectionFlags?.(s),
          selectState: ticked === 0 ? "none" : ticked === ids.length ? "all" : "some",
          onToggleSelect: () => {
            const allOn = ticked === ids.length;
            for (const id of ids) if (selection.isSelected(id) === allOn) selection.toggle(id);
          },
        };
      }),
    [sections, selection, sectionMenu, sectionFlags],
  );
  return <LineRowList sections={list} columns={JOB_COLUMNS} selection={selection} />;
}

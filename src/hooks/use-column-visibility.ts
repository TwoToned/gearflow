"use client";

import * as React from "react";
import { Columns3 } from "lucide-react";

import type { ActionItem, FactColumn } from "@/lib/primitives/types";

/** One localStorage entry for every list: `{ [listKey]: opted-in optional column ids }`. */
const COL_VIS_STORAGE_KEY = "colVis";

function readAll(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COL_VIS_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeOne(key: string, ids: string[]) {
  try {
    localStorage.setItem(COL_VIS_STORAGE_KEY, JSON.stringify({ ...readAll(), [key]: ids }));
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

/**
 * The column-visibility picker for a list (playbook §3.8): `optional` columns are hidden
 * until the user opts in from the page ⋯ › Columns. Returns the columns to render and the
 * menu item to merge into the page menu (absent when the list has no optional column).
 * The choice is per-browser (`colVis`), never in the URL.
 */
export function useColumnVisibility(listKey: string | undefined, columns: FactColumn[]) {
  const [on, setOn] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (listKey) setOn(readAll()[listKey] ?? []);
  }, [listKey]);

  const optional = columns.filter((c) => c.optional);
  const visible = columns.filter((c) => !c.optional || on.includes(c.id));

  const toggle = (id: string) => {    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    setOn(next);
    if (listKey) writeOne(listKey, next);
  };

  const item: ActionItem | undefined =
    listKey && optional.length > 0
      ? {
          key: "columns",
          label: "Columns",
          group: "organise",
          icon: Columns3,
          onSelect: () => {},
          children: optional.map((c) => ({
            key: `col-${c.id}`,
            label: `${on.includes(c.id) ? "Hide" : "Show"} ${c.header}`,
            group: "organise" as const,
            onSelect: () => toggle(c.id),
          })),
        }
      : undefined;

  return { columns: visible, item };
}

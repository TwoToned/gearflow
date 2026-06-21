"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Table as TableIcon } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { AssetGallery } from "./asset-gallery";
import { AssetTable } from "./asset-table";

type Mode = "grid" | "table";
const KEY = "assets-view-mode";

/**
 * Asset registry — a visual gear-library Grid (default) with a dense Table toggle.
 * Grid = browse "what gear do we own" as cards; Table = power view (filters, saved
 * views, bulk-select, CSV import/export). Choice persists in localStorage.
 *
 * Both views read the SAME reactive Convex source (`useAssets` + the shared
 * registry-photos query), so they always show the same assets. The Table view
 * keeps ALL of its existing behaviour untouched — the Grid only adds a calmer
 * browse surface with its own search.
 */
export function AssetsView() {
  const [mode, setMode] = useState<Mode>("grid");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (saved === "grid" || saved === "table") setMode(saved);
  }, []);

  const choose = (m: Mode) => {
    setMode(m);
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      /* ignore */
    }
  };

  const toggle = (
    <div className="inline-flex rounded-[var(--r)] border border-line bg-card p-0.5 shadow-[var(--sh-card)]">
      {([["grid", LayoutGrid, "Grid"], ["table", TableIcon, "Table"]] as const).map(
        ([m, Icon, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => choose(m)}
            aria-pressed={mode === m}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[calc(var(--r)-3px)] px-3 py-1.5 text-table-cell font-medium transition-colors",
              focusRing,
              mode === m ? "bg-elev text-ink shadow-[var(--sh-stk)]" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ),
      )}
    </div>
  );

  // Grid carries the toggle inline with its own search/new-asset toolbar.
  // Table renders the toggle above its built-in toolbar (search/filters/bulk/CSV).
  return mode === "grid" ? (
    <AssetGallery toolbar={toggle} />
  ) : (
    <div className="space-y-4">
      <div className="flex justify-end">{toggle}</div>
      <AssetTable />
    </div>
  );
}

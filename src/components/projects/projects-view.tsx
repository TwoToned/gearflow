"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Table as TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectBoard } from "./project-board";
import { ProjectTable } from "./project-table";

type Mode = "board" | "table";
const KEY = "projects-view-mode";

/**
 * Projects list — a status pipeline Board (default) with a Table toggle.
 * Board = "where every job is" triage; Table = dense power view (filters,
 * saved views, column prefs). Choice persists in localStorage.
 */
export function ProjectsView() {
  const [mode, setMode] = useState<Mode>("table");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (saved === "board" || saved === "table") setMode(saved);
  }, []);

  const choose = (m: Mode) => {
    setMode(m);
    try { window.localStorage.setItem(KEY, m); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="inline-flex rounded-[var(--r)] border border-line bg-card p-0.5 shadow-[var(--sh-card)]">
          {([["board", LayoutGrid, "Board"], ["table", TableIcon, "Table"]] as const).map(([m, Icon, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => choose(m)}
              aria-pressed={mode === m}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[calc(var(--r)-3px)] px-3 py-1.5 text-table-cell font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
                mode === m ? "bg-elev text-ink shadow-[var(--sh-stk)]" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "board" ? <ProjectBoard /> : <ProjectTable />}
    </div>
  );
}

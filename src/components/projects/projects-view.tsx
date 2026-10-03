"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { List, Kanban } from "lucide-react";
import { ProjectTable } from "./project-table";
import { ProjectBoard } from "./project-board";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";

/**
 * Projects list — the table is the default view (filters, saved views,
 * column prefs). `?view=board` revives the 7-column lifecycle kanban
 * (#1244, design §8.3) — dead code before this phase (no consumer rendered
 * it). The table stays the default per the issue's own guardrail ("the
 * table remains the default view").
 */
export function ProjectsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "board" ? "board" : "table";

  function setView(next: "table" | "board") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "table") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1 rounded-[var(--r-lg)] border border-line bg-paper-2 p-1">
        <Button
          type="button"
          size="sm"
          variant={view === "table" ? "line" : "ghost"}
          className={cn("h-7 gap-1.5", focusRing)}
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
        >
          <List className="h-3.5 w-3.5" />
          Table
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "board" ? "line" : "ghost"}
          className={cn("h-7 gap-1.5", focusRing)}
          aria-pressed={view === "board"}
          onClick={() => setView("board")}
        >
          <Kanban className="h-3.5 w-3.5" />
          Board
        </Button>
      </div>
      {view === "board" ? <ProjectBoard /> : <ProjectTable />}
    </div>
  );
}

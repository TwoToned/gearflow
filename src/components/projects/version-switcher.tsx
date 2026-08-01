"use client";

import { Check, ChevronDown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useProjectVersion, type ProjectVersionListItem } from "@/components/projects/project-version-context";

/** `[state]` label for a version row — "Live" per decision 13 (design doc),
 *  never "Latest": a promoted older version can sit above a newer one, so a
 *  recency word would fight what's on screen. */
function stateLabel(v: ProjectVersionListItem): string {
  if (v.isLive) return "Live";
  switch (v.status) {
    case "DRAFT":
      return v.snapshotReason === "PRE_PROMOTE" ? "Auto-saved" : "Saved";
    case "SENT":
      return "Sent";
    case "ACCEPTED":
      return "Accepted";
    case "DECLINED":
      return "Declined";
    case "SUPERSEDED":
      return "Superseded";
    case "EXPIRED":
      return "Expired";
    default:
      return v.status;
  }
}

function dateFor(v: ProjectVersionListItem): number | undefined {
  return v.acceptedAt ?? v.sentAt ?? v.createdAt;
}

function formatShortDate(ms: number | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Header version switcher (design doc §4.1) — mounted next to the project
 * number/status chip, not inside a tab (this is project-wide). Lists every
 * revision with a quote row, its state, date and total, and updates `?v=`.
 * Navigation only — "Make vN live…" (#1080/#1097) lives on the read-only bar
 * that appears once you've switched to viewing that version
 * (`<VersionReadOnlyBar>`) and on the Finance tab's version rail
 * (`<ProjectQuoteRail>`), not as a second promote entry point inside this
 * menu (R-3.1). "Save version…" (creating a new version from here) remains
 * unbuilt — the entry below opens nothing yet and stays absent until that
 * verb exists, rather than shipping a dead menu item.
 */
export function ProjectVersionSwitcher() {
  const { versions, isLoadingVersions, liveRevision, viewingRevision, isViewingVersion, setViewingRevision } =
    useProjectVersion();

  if (isLoadingVersions || versions.length === 0) return null;

  const activeRevision = isViewingVersion ? viewingRevision : liveRevision;
  const activeVersion = versions.find((v) => v.revision === activeRevision);
  const triggerLabel = activeVersion ? `v${activeVersion.revision}${activeVersion.isLive ? " · Live" : ""}` : "Versions";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="line" size="sm" className="gap-1.5" aria-label="Switch project version">
          <History className="h-3.5 w-3.5" />
          <span>{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Versions</DropdownMenuLabel>
        </DropdownMenuGroup>
        {versions.map((v) => {
          const isActive = v.revision === activeRevision;
          const date = formatShortDate(dateFor(v));
          return (
            <DropdownMenuItem
              key={v.revision}
              className="flex items-center gap-2"
              onClick={() => setViewingRevision(v.isLive ? null : v.revision)}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              <span className={cn("flex-1 truncate", v.isLive && "font-semibold")}>
                v{v.revision} · {stateLabel(v)}
                {v.label ? ` · ${v.label}` : ""}
              </span>
              <span className="shrink-0 text-caption text-muted">
                {date}
                {v.total != null ? ` · ${formatCurrency(v.total)}` : ""}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-caption text-muted">
          Switch to a version to make it live, or use the Finance tab&apos;s version list.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, GitCompare, History, Plus, Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { VersionsPanel } from "@/components/projects/versions-panel";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.1) — the
 * header pill (`v4 · Live ▾`). Together with the Versions panel it opens,
 * this is ONE of the two surfaces the design allows a version verb to live
 * on ("one control to switch, one place to manage") — replaces the old
 * switcher that also embedded Send/Download/Make-live/Delete row actions
 * (now the panel's job) and consolidates what used to be up to four separate
 * entry points for the same verb.
 *
 * Menu: every version (switch), New version, Compare (disabled stub — #1232,
 * a later phase), Manage versions… (opens the panel). The `V` keyboard
 * shortcut also opens the panel directly (DESIGN.md §4 — disabled while an
 * input/textarea is focused or any dialog/sheet is already open).
 */

function stateLabel(isLive: boolean, contentState: "ready" | "missing"): string {
  if (isLive) return "Live";
  return contentState === "missing" ? "No content" : "Draft";
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** `V` opens the Versions panel — skipped while typing or while any
 *  dialog/sheet/menu (Radix content) is already open, per DESIGN.md §4. */
function useVersionPanelShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "v" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"]')) return;
      e.preventDefault();
      onOpen();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

export function ProjectVersionSwitcher() {
  const { projectId, versions, isLoadingVersions, liveVersion, viewingNumber, isViewingVersion, setViewingNumber } =
    useProjectVersion();
  const canPublish = useCanDo("invoice", "publish");
  const { createVersion } = useProjectVersionWrites(projectId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useVersionPanelShortcut(() => setPanelOpen(true));

  const addVersion = useServerMutation({
    mutationFn: () => createVersion({ fromVersionId: viewingNumber != null ? versions.find((v) => v.number === viewingNumber)?.id : liveVersion?.id }),
    onSuccess: (r) => {
      toast.success(`Created v${r.number}`);
      setViewingNumber(r.number);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoadingVersions || versions.length === 0) return null;

  const activeVersion = isViewingVersion ? versions.find((v) => v.number === viewingNumber) : liveVersion;
  const triggerLabel = activeVersion ? `v${activeVersion.number}${activeVersion.isLive ? " · Live" : ""}` : "Versions";

  function closeMenuThen(fn: () => void) {
    setMenuOpen(false);
    fn();
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="line" size="sm" className="gap-1.5" aria-label="Project versions">
            <History className="h-3.5 w-3.5" />
            <span>{triggerLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Versions</DropdownMenuLabel>
          </DropdownMenuGroup>
          {versions.map((v) => {
            const isActive = v.isLive ? !isViewingVersion : v.number === viewingNumber;
            return (
              <DropdownMenuItem
                key={v.id}
                onClick={() => closeMenuThen(() => setViewingNumber(v.isLive ? null : v.number))}
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {isActive && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", v.isLive && "font-semibold")}>
                    v{v.number} · {stateLabel(v.isLive, v.contentState)}
                    {v.label ? ` · ${v.label}` : ""}
                  </span>
                  <span className="block text-caption text-muted">{formatShortDate(v.createdAt)}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          {canPublish && (
            <DropdownMenuItem disabled={addVersion.isPending} onClick={() => addVersion.mutate(undefined)}>
              <Plus className="h-3.5 w-3.5" /> New version{activeVersion ? ` from v${activeVersion.number}` : ""}
            </DropdownMenuItem>
          )}
          {/* Compare is a mode on the real page — tracked separately (#1232),
              deliberately not built here. A disabled stub keeps the menu shape
              stable so wiring it up later doesn't move every other item. */}
          <DropdownMenuItem disabled aria-disabled="true">
            <GitCompare className="h-3.5 w-3.5" /> Compare
            <span className="ml-auto text-caption text-faint">Soon</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => closeMenuThen(() => setPanelOpen(true))}>
            <Sparkles className="h-3.5 w-3.5" /> Manage versions…
            <span className="ml-auto text-caption text-faint">V</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <VersionsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        projectId={projectId}
        versions={versions}
        liveVersion={liveVersion}
        viewingNumber={viewingNumber}
        onSwitch={setViewingNumber}
      />
    </>
  );
}

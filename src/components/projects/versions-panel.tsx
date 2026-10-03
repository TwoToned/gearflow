"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RowActionsMenu, type RowAction } from "@/components/ui/row-actions-menu";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useCanDo } from "@/lib/use-permissions";
import { useProjectVersionWrites, type MakeLiveResult } from "@/hooks/use-project-version-writes";
import { MakeLiveDialog } from "@/components/projects/finance/make-live-dialog";
import { cn } from "@/lib/utils";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.1/§5's
 * "VersionsPanel" mockup) — the ONLY place versions are created, renamed,
 * made live or deleted (Compare is a disabled stub in the header pill —
 * #1232, out of scope here). A right-hand sheet (Radix `Dialog` primitive
 * under the hood, `sheet.tsx`) opened by the header pill's "Manage
 * versions…" entry or the `V` keyboard shortcut.
 */

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function versionRowActions(
  v: ProjectVersionSummary,
  canPublish: boolean,
  handlers: { onMakeLive: () => void; onRename: () => void; onDelete: () => void },
): RowAction[] {
  if (!canPublish) return [{ key: "rename", label: "Rename", icon: Pencil, onClick: handlers.onRename }];
  const actions: RowAction[] = [{ key: "rename", label: "Rename", icon: Pencil, onClick: handlers.onRename }];
  if (!v.isLive) {
    actions.unshift({ key: "make-live", label: `Make v${v.number} live`, icon: Sparkles, onClick: handlers.onMakeLive });
    actions.push({ key: "delete", label: "Delete version", icon: Trash2, onClick: handlers.onDelete, destructive: true });
  }
  return actions;
}

function VersionRow({
  v,
  isViewing,
  canPublish,
  onSwitch,
  onMakeLive,
  onRename,
  onDelete,
}: {
  v: ProjectVersionSummary;
  isViewing: boolean;
  canPublish: boolean;
  onSwitch: () => void;
  onMakeLive: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const actions = versionRowActions(v, canPublish, { onMakeLive, onRename, onDelete });
  return (
    <div className="flex items-center gap-1 rounded-[var(--r)] border border-line px-2 py-2 hover:bg-elev">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSwitch}>
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {isViewing && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-ui-text", v.isLive && "font-semibold")}>
            v{v.number}
            {v.isLive ? " · Live" : ""}
            {v.label ? ` · ${v.label}` : ""}
          </span>
          <span className="block text-caption text-muted">
            {formatDate(v.createdAt)}
            {v.contentState === "missing" ? " · no captured content" : ""}
          </span>
        </span>
      </button>
      <RowActionsMenu actions={actions} label={`v${v.number} actions`} />
    </div>
  );
}

/** Wrapper renders null with no `target`; the inner component is KEYED by
 *  `target.id` so switching targets remounts it with a fresh, correctly-
 *  seeded field instead of carrying stale `useState` across a prop change
 *  (React only re-runs a `useState` initializer on mount) — same pattern
 *  `project-quote-rail.tsx`'s `EditLabelDialog`/`EditLabelDialogContent` used. */
function RenameDialog({
  target,
  projectId,
  onClose,
}: {
  target: ProjectVersionSummary | null;
  projectId: string;
  onClose: () => void;
}) {
  if (!target) return null;
  return <RenameDialogContent key={target.id} target={target} projectId={projectId} onClose={onClose} />;
}

function RenameDialogContent({
  target,
  projectId,
  onClose,
}: {
  target: ProjectVersionSummary;
  projectId: string;
  onClose: () => void;
}) {
  const { setLabel } = useProjectVersionWrites(projectId);
  const [value, setValue] = useState(target.label ?? "");
  const mutation = useServerMutation({
    mutationFn: () => setLabel(target.id, value || undefined),
    onSuccess: () => {
      toast.success(value ? `Labelled v${target.number} "${value}"` : `Cleared v${target.number}'s label`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename v{target.number}</DialogTitle>
          <DialogDescription>An internal name — never printed unless checked at send time.</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. With LED wall"
          maxLength={60}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate(undefined)}>
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteVersionConfirm({
  target,
  projectId,
  onClose,
}: {
  target: ProjectVersionSummary | null;
  projectId: string;
  onClose: () => void;
}) {
  const { deleteVersion } = useProjectVersionWrites(projectId);
  const mutation = useServerMutation({
    mutationFn: () => deleteVersion(target!.id),
    onSuccess: (r) => {
      toast.success(`Deleted v${r.number}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!target) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete v{target.number}?</DialogTitle>
          <DialogDescription>
            This permanently deletes v{target.number}
            {target.label ? ` ("${target.label}")` : ""} and every line item on it. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="line"
            className="border-t-out text-t-out hover:bg-t-out hover:text-white"
            loading={mutation.isPending}
            onClick={() => mutation.mutate(undefined)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface VersionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  versions: ProjectVersionSummary[];
  liveVersion: ProjectVersionSummary | null;
  viewingNumber: number | null;
  onSwitch: (number: number | null) => void;
}

export function VersionsPanel({ open, onOpenChange, projectId, versions, liveVersion, viewingNumber, onSwitch }: VersionsPanelProps) {
  const canPublish = useCanDo("invoice", "publish");
  const { createVersion } = useProjectVersionWrites(projectId);
  const [renameTarget, setRenameTarget] = useState<ProjectVersionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectVersionSummary | null>(null);
  const [makeLiveTarget, setMakeLiveTarget] = useState<ProjectVersionSummary | null>(null);

  const createMutation = useServerMutation({
    mutationFn: () => createVersion({ fromVersionId: (viewingNumber != null ? versions.find((v) => v.number === viewingNumber) : liveVersion)?.id }),
    onSuccess: (r) => {
      toast.success(`Created v${r.number}`);
      onSwitch(r.number);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Versions</SheetTitle>
            <SheetDescription>Switch, rename, make live or delete. One place for every version verb.</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {versions.map((v) => (
              <VersionRow
                key={v.id}
                v={v}
                isViewing={v.isLive ? viewingNumber == null : v.number === viewingNumber}
                canPublish={canPublish}
                onSwitch={() => onSwitch(v.isLive ? null : v.number)}
                onMakeLive={() => setMakeLiveTarget(v)}
                onRename={() => setRenameTarget(v)}
                onDelete={() => setDeleteTarget(v)}
              />
            ))}
          </div>

          {canPublish && (
            <Button type="button" variant="line" size="sm" loading={createMutation.isPending} onClick={() => createMutation.mutate(undefined)}>
              <Plus className="h-3.5 w-3.5" /> New version{viewingNumber != null ? ` from v${viewingNumber}` : liveVersion ? ` from v${liveVersion.number}` : ""}
            </Button>
          )}
        </SheetContent>
      </Sheet>

      <RenameDialog target={renameTarget} projectId={projectId} onClose={() => setRenameTarget(null)} />
      <DeleteVersionConfirm target={deleteTarget} projectId={projectId} onClose={() => setDeleteTarget(null)} />
      {makeLiveTarget && (
        <MakeLiveDialog
          open
          onOpenChange={(o) => !o && setMakeLiveTarget(null)}
          targetVersion={makeLiveTarget}
          liveVersion={liveVersion}
          projectId={projectId}
          onMadeLive={(r: MakeLiveResult) => {
            if (r.conflicts.length === 0) {
              setMakeLiveTarget(null);
              onSwitch(null);
            }
          }}
        />
      )}
    </>
  );
}

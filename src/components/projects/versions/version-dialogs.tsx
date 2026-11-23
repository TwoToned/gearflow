"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { showError } from "@/lib/show-error";
import { useSaveVersion } from "@/components/projects/versions/use-save-version";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

/**
 * The two small version dialogs (UX Phase 8, §7b.4): Rename and Save as new
 * version. Both are `Dialog`s with explicit buttons (no AlertDialog exists),
 * both 16px inputs (the shared `Input`). Deleting a version is not here: the
 * row ⋯'s red item carries its own `confirm` (`buildVersionRowActions`).
 */

/** Wrapper renders null with no `target`; the inner component is KEYED by
 *  `target.id` so switching targets remounts it with a fresh, correctly
 *  seeded field (a `useState` initializer only runs on mount). */
export function RenameVersionDialog({
  target,
  projectId,
  onClose,
}: {
  target: ProjectVersionSummary | null;
  projectId: string;
  onClose: () => void;
}) {
  if (!target) return null;
  return <RenameVersionContent key={target.id} target={target} projectId={projectId} onClose={onClose} />;
}

function RenameVersionContent({ target, projectId, onClose }: { target: ProjectVersionSummary; projectId: string; onClose: () => void }) {
  const { setLabel } = useProjectVersionWrites(projectId);
  const [value, setValue] = useState(target.label ?? "");
  const mutation = useServerMutation({
    mutationFn: () => setLabel(target.id, value.trim() || undefined),
    onSuccess: () => {
      toast.success(value.trim() ? `Labelled v${target.number} “${value.trim()}”` : `Cleared v${target.number}’s name`);
      onClose();
    },
    onError: (e: Error) => showError(e, { fallbackTitle: "Couldn't rename" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename v{target.number}</DialogTitle>
          <DialogDescription>An internal name. It is never printed unless checked at send time.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(undefined);
          }}
          className="space-y-4"
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. With LED wall" maxLength={60} autoFocus aria-label="Version name" />
          <DialogFooter>
            <Button type="button" variant="line" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Save as new version: an optional name, then ONE `createNative` copy of
 * `fromVersion` (lines, cases and the packing plan; the live version does not
 * change). The toast's Undo deletes exactly that new version (`useSaveVersion`).
 */
export function SaveVersionDialog({
  open,
  onOpenChange,
  projectId,
  fromVersion,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The version the copy is taken from (the one on screen, or the row's own). */
  fromVersion: ProjectVersionSummary | null;
  onSaved: (created: { id: string; number: number }) => void;
}) {
  if (!open || !fromVersion) return null;
  return <SaveVersionContent key={fromVersion.id} projectId={projectId} fromVersion={fromVersion} onOpenChange={onOpenChange} onSaved={onSaved} />;
}

function SaveVersionContent({
  projectId,
  fromVersion,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  fromVersion: ProjectVersionSummary;
  onOpenChange: (open: boolean) => void;
  onSaved: (created: { id: string; number: number }) => void;
}) {
  const [label, setLabel] = useState("");
  const { save, isPending } = useSaveVersion(projectId, (created) => {
    onOpenChange(false);
    onSaved(created);
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as new version</DialogTitle>
          <DialogDescription>
            A full copy of v{fromVersion.number}: lines, cases and the packing plan. The live version does not change.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({ fromVersionId: fromVersion.id, label: label.trim() || undefined });
          }}
          className="space-y-4"
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional), e.g. With LED wall" maxLength={60} autoFocus aria-label="Version name" />
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending}>
              Save as new version
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

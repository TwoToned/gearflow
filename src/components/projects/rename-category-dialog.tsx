"use client";

/**
 * Rename-category dialog — single text input + Rename button.
 * Extracted from equipment-tab.tsx in Phase 7. Form state seeds from
 * initialValue on each fresh open via the keyed body pattern.
 */

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LockedEditorOverlay } from "@/components/collaboration/locked-editor-overlay";
import { useEditLock } from "@/hooks/use-collaboration";
import { COLLAB_TARGET_TYPES } from "@/lib/collaboration-targets";

interface RenameCategoryDialogProps {
  /** Category id being renamed. Null closes the dialog. */
  categoryId: string | null;
  /** Current name to pre-fill in the input. */
  initialValue: string;
  isPending: boolean;
  projectId?: string;
  orgId?: string;
  onClose: () => void;
  onSubmit: (categoryId: string, name: string) => void;
}

export function RenameCategoryDialog(props: RenameCategoryDialogProps) {
  return (
    <Dialog open={props.categoryId != null} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-w-sm">
        {props.categoryId && (
          <RenameCategoryDialogBody key={props.categoryId} {...props} categoryId={props.categoryId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameCategoryDialogBody({
  categoryId,
  initialValue,
  isPending,
  projectId,
  orgId,
  onClose,
  onSubmit,
}: RenameCategoryDialogProps & { categoryId: string }) {
  const [name, setName] = useState(initialValue);
  const { lockState, isLocked, isStale, takeover } = useEditLock({
    entityType: "project",
    entityId: projectId ?? "",
    targetType: COLLAB_TARGET_TYPES.category,
    targetId: categoryId,
    active: true,
    enabled: !!orgId && !!projectId,
  });

  function handleSubmit() {
    if (!name.trim() || isLocked) return;
    onSubmit(categoryId, name.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename category</DialogTitle>
      </DialogHeader>
      <LockedEditorOverlay
        lockState={lockState}
        onTakeover={isStale ? () => void takeover() : undefined}
      />
      <Input
        placeholder="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        autoFocus
        disabled={isLocked}
      />
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name.trim() || isPending || isLocked}>
          Rename
        </Button>
      </DialogFooter>
    </>
  );
}

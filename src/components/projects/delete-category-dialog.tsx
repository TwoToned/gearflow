"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { categoryDeleteBody, categoryDeleteImpact, type CategoryDeleteInput } from "@/lib/category-delete-impact";

/** Confirms a category delete and says what happens downstream (no Undo: groups are removed). */
export function DeleteCategoryDialog({
  category,
  isPending,
  onClose,
  onConfirm,
}: {
  /** Null closes the dialog. */
  category: (CategoryDeleteInput & { id: string }) | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const lines = category ? categoryDeleteBody(categoryDeleteImpact(category)) : [];
  return (
    <Dialog open={category != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {category?.name}?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-ui-text text-ink-2">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isPending} onClick={() => category && onConfirm(category.id)}>
            Delete category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

interface RenameCategoryDialogProps {
  /** Category id being renamed. Null closes the dialog. */
  categoryId: string | null;
  /** Current name to pre-fill in the input. */
  initialValue: string;
  isPending: boolean;
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
  onClose,
  onSubmit,
}: RenameCategoryDialogProps & { categoryId: string }) {
  const [name, setName] = useState(initialValue);

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit(categoryId, name.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename category</DialogTitle>
      </DialogHeader>
      <Input
        placeholder="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        autoFocus
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
          Rename
        </Button>
      </DialogFooter>
    </>
  );
}

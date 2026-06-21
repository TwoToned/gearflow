"use client";

/**
 * New-category dialog — single text input + Create button. Extracted
 * from equipment-tab.tsx in Phase 7. Form state lives inside the body
 * keyed by the dialog's open state so each fresh open resets cleanly.
 */

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddCategoryDialogProps {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}

export function AddCategoryDialog(props: AddCategoryDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-sm">
        {props.open && <AddCategoryDialogBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function AddCategoryDialogBody({
  isPending,
  onOpenChange,
  onSubmit,
}: AddCategoryDialogProps) {
  const [name, setName] = useState("");

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit(name.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New category</DialogTitle>
        <DialogDescription>
          Categories organize equipment into sections (e.g. RF, IEM, PA).
        </DialogDescription>
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
        <Button variant="line" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
          Create
        </Button>
      </DialogFooter>
    </>
  );
}

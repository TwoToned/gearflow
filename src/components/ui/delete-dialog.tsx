"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";

/**
 * Standardized destructive-action confirmation dialog.
 *
 * Use this for cascading or single-item-but-heavy destructive actions where
 * the user needs to read a consequence summary before confirming.
 *
 * For lighter row-level deletes inside a dropdown menu, prefer
 * `ConfirmActionMenuItem` (inline two-step confirm).
 *
 * For bulk deletes (>10 items) with a typed-confirmation safety net,
 * use `BulkDeleteDialog`.
 *
 * Per CLAUDE.md: this is a `Dialog`, not `AlertDialog` (which doesn't exist
 * in this codebase).
 */
interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Human-readable consequence summary. Plain text or React node. */
  description: React.ReactNode;
  /** Confirm button label. Defaults to "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Fires when the user confirms. */
  onConfirm: () => void;
  /** When true, the confirm button is disabled (e.g. mutation pending). */
  pending?: boolean;
}

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  pending,
}: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-1.5">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{cancelLabel}</DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
            }}
            disabled={pending}
          >
            {pending ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

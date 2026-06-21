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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

/**
 * Bulk destructive action confirmation with a typed-confirmation safety net.
 *
 * Use this when more than ~10 items are being deleted at once. The user must
 * type the confirmation phrase (defaults to "DELETE") before the confirm
 * button enables.
 *
 * For single-item destructive actions, use `DeleteDialog`.
 * For inline row-level confirms inside a DropdownMenu, use `ConfirmActionMenuItem`.
 */
interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Human-readable description of what will happen. */
  description: React.ReactNode;
  /** Count of items being affected (rendered prominently). */
  count: number;
  /** Label for the unit being deleted, e.g. "asset" → "5 assets". */
  itemLabel?: string;
  /** Phrase the user must type. Defaults to "DELETE". */
  confirmPhrase?: string;
  /** Confirm button label. Defaults to "Delete {count} {itemLabel}s". */
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  count,
  itemLabel = "item",
  confirmPhrase = "DELETE",
  confirmLabel,
  onConfirm,
  pending,
}: BulkDeleteDialogProps) {
  const [typed, setTyped] = React.useState("");
  const matches = typed.trim() === confirmPhrase;

  // Reset typed-confirmation whenever the dialog re-opens
  React.useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const resolvedConfirmLabel =
    confirmLabel ?? `Delete ${count} ${itemLabel}${count === 1 ? "" : "s"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 pl-12">
          <div className="rounded-md bg-destructive/5 border-l-2 border-destructive px-3 py-2">
            <div className="t-overline text-destructive/80">Affects</div>
            <div className="t-heading text-destructive t-data mt-0.5">
              {count} {itemLabel}
              {count === 1 ? "" : "s"}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-delete-confirm" className="t-micro">
              Type <span className="font-mono text-destructive">{confirmPhrase}</span> to confirm
            </Label>
            <Input
              id="bulk-delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="line">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={() => onConfirm()}
            disabled={!matches || pending}
          >
            {pending ? "Working..." : resolvedConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

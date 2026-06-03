"use client";

/**
 * Delete-group confirmation dialog — shows item count and revenue
 * impact before letting the user delete a ProjectGroup. Extracted
 * from equipment-tab.tsx in Phase 7.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";

export interface DeleteGroupInfo {
  title: string;
  price: number;
  itemCount: number;
}

interface DeleteGroupDialogProps {
  /** Group id being deleted. Null closes the dialog. */
  groupId: string | null;
  /** Summary metadata shown in the body. */
  info: DeleteGroupInfo | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (groupId: string) => void;
}

export function DeleteGroupDialog({
  groupId,
  info,
  isPending,
  onClose,
  onConfirm,
}: DeleteGroupDialogProps) {
  return (
    <Dialog open={groupId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete group</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{info?.title}&rdquo;?
          </DialogDescription>
        </DialogHeader>
        {info && (
          <div className="rounded-lg bg-bg-inset p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-fg-3">Items</span>
              <span className="text-fg-2">{info.itemCount} will become standalone</span>
            </div>
            {info.price > 0 && (
              <div className="flex justify-between">
                <span className="text-fg-3">Revenue impact</span>
                <span className="font-medium text-[oklch(0.58_0.22_27)]">
                  -{formatCurrency(info.price)}
                </span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => groupId && onConfirm(groupId)}
            disabled={isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

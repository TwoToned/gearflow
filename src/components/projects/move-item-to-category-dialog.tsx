"use client";

/**
 * Move-item-to-category dialog — picks a destination ProjectCategory
 * (or Uncategorised) for a single line item. Always lands the item
 * with `groupId: null` so it appears as a standalone item under the
 * category (or in the project's top-level Uncategorized zone).
 *
 * Pairs with `move-item-to-group-dialog.tsx`. The two dialogs replaced
 * the old combined `move-line-item-dialog.tsx` in v0.9.3.0 because
 * mixing "category" and "group" options in one picker produced a
 * confusing UX (v0.9.1.0–v0.9.2.1 user reports).
 *
 * Submission contract: `onSubmit(lineItemId, { categoryId, groupId: null })`.
 * The parent owns the mutation and routes to `moveLineItemToGroup`.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CategoryData } from "./equipment-rows";

const UNCATEGORISED_VALUE = "__uncategorized__";

export interface MoveItemTarget {
  /** null → uncategorised (no category). */
  categoryId: string | null;
  /** Always null for the category-only dialog. */
  groupId: null;
}

interface MoveItemToCategoryDialogProps {
  /** Line item being moved. Null closes the dialog. */
  lineItemId: string | null;
  /** Pre-select a category id, or `__uncategorized__`. Empty/undefined
   *  defaults to Uncategorised. */
  initialCategoryId?: string;
  categories: CategoryData[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (lineItemId: string, target: MoveItemTarget) => void;
}

export function MoveItemToCategoryDialog(props: MoveItemToCategoryDialogProps) {
  return (
    <Dialog
      open={props.lineItemId != null}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
    >
      <DialogContent className="sm:max-w-sm">
        {props.lineItemId && (
          <MoveItemToCategoryDialogBody key={props.lineItemId} {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveItemToCategoryDialogBody({
  lineItemId,
  initialCategoryId,
  categories,
  isPending,
  onClose,
  onSubmit,
}: MoveItemToCategoryDialogProps) {
  const [selected, setSelected] = useState<string>(
    initialCategoryId && initialCategoryId.length > 0
      ? initialCategoryId
      : UNCATEGORISED_VALUE,
  );

  function handleSubmit() {
    if (!lineItemId) return;
    onSubmit(lineItemId, {
      categoryId: selected === UNCATEGORISED_VALUE ? null : selected,
      groupId: null,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move to category</DialogTitle>
        <DialogDescription>
          The item lands under the category as a standalone item — no group.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value={UNCATEGORISED_VALUE}>Uncategorized</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Move
        </Button>
      </DialogFooter>
    </>
  );
}

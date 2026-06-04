"use client";

/**
 * Move-line-item dialog — picks a destination ProjectGroup (or
 * "Uncategorised" within a category) for a single line item.
 *
 * Extracted from equipment-tab.tsx in Phase 7. The parent owns the
 * mutation; this component only renders the picker + dispatches.
 * Mirrors the wrapper-plus-keyed-body pattern from
 * MoveSubHireGroupDialog / PriceEditDialog so the destination resets
 * cleanly on each fresh open without a setState-in-effect.
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

export interface MoveLineItemTarget {
  /** null/undefined → uncategorised. Otherwise category id. */
  categoryId: string | null;
  /** null/undefined → no group (standalone in category). */
  groupId: string | null;
}

interface MoveLineItemDialogProps {
  /** Line item being moved. Null closes the dialog. */
  lineItemId: string | null;
  /** Pre-selected encoded destination ("__uncategorized__" or "<cat>|<grp>"). */
  initialEncoded?: string;
  categories: CategoryData[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (lineItemId: string, target: MoveLineItemTarget) => void;
}

export function MoveLineItemDialog(props: MoveLineItemDialogProps) {
  return (
    <Dialog open={props.lineItemId != null} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        {props.lineItemId && (
          <MoveLineItemDialogBody key={props.lineItemId} {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveLineItemDialogBody({
  lineItemId,
  initialEncoded,
  categories,
  isPending,
  onClose,
  onSubmit,
}: MoveLineItemDialogProps) {
  const [encoded, setEncoded] = useState<string>(initialEncoded ?? UNCATEGORISED_VALUE);

  function handleSubmit() {
    if (!lineItemId) return;
    if (encoded === UNCATEGORISED_VALUE) {
      onSubmit(lineItemId, { categoryId: null, groupId: null });
      return;
    }
    // Encoded shape: "<catId>|<grpId>". An empty trailing segment
    // (e.g. "<catId>|") means "category root, no specific group" —
    // the item lands as a standalone item under that category.
    const [catId, grpId] = encoded.split("|");
    onSubmit(lineItemId, {
      categoryId: catId || null,
      groupId: grpId ? grpId : null,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move Item</DialogTitle>
        <DialogDescription>
          Choose a destination group or category for this item.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-2">
        <select
          value={encoded}
          onChange={(e) => setEncoded(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value={UNCATEGORISED_VALUE}>Uncategorized (no group)</option>
          {categories.map((cat) => (
            // Each category contributes:
            //   1. A "category root" option ("<name> (no group)") so the
            //      item can live directly under the category as a
            //      standalone item.
            //   2. One option per group inside it ("<name> > <group>").
            // Without (1) the dialog promises "destination group or
            // category" in the description but only ever lets you
            // pick a group, which is what the v0.9.2.0 user-reported
            // bug surfaced.
            <optgroup key={cat.id} label={cat.name}>
              <option value={`${cat.id}|`}>{cat.name} (no group)</option>
              {cat.groups.map((g) => (
                <option key={g.id} value={`${cat.id}|${g.id}`}>
                  {cat.name} &gt; {g.title}
                </option>
              ))}
            </optgroup>
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

"use client";

/**
 * Move-item-to-group dialog — picks a destination ProjectGroup for
 * a single line item. The picker lists every group in the project,
 * labelled `<category> > <group>` and visually clustered by category
 * via `<optgroup>` so projects with many categories stay scannable.
 *
 * Pairs with `move-item-to-category-dialog.tsx`. The two dialogs
 * replaced the old combined `move-line-item-dialog.tsx` in v0.9.3.0.
 *
 * If the project has zero groups, the picker renders an explanatory
 * empty state instead of an empty dropdown — the user is told to
 * create a group first, with a cancel button to close out cleanly.
 *
 * Submission contract:
 *   onSubmit(lineItemId, { categoryId: <owning cat>, groupId: <picked> })
 * The parent owns the mutation and routes to `moveLineItemToGroup`.
 */

import { useMemo, useState } from "react";
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

export interface MoveItemToGroupTarget {
  /** The owning category of the picked group — kept in sync with
   *  `groupId` so the line item's `categoryId` follows its group.
   *  `null` when the target is an uncategorized-zone group (no category). */
  categoryId: string | null;
  groupId: string;
}

interface MoveItemToGroupDialogProps {
  lineItemId: string | null;
  /** Pre-select a group id. Empty/undefined leaves the picker on
   *  the first available group. */
  initialGroupId?: string;
  categories: CategoryData[];
  /** Groups living in the "Uncategorized" zone (categoryId === null). These are
   *  NOT under any `categories[]` entry, so without them the picker silently
   *  omits every uncategorized-zone group as a move target — and if a project's
   *  ONLY groups are uncategorized, the picker falsely claimed "no groups exist". */
  uncategorizedGroups?: { id: string; title: string }[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (lineItemId: string, target: MoveItemToGroupTarget) => void;
}

export function MoveItemToGroupDialog(props: MoveItemToGroupDialogProps) {
  return (
    <Dialog
      open={props.lineItemId != null}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
    >
      <DialogContent className="sm:max-w-sm">
        {props.lineItemId && (
          <MoveItemToGroupDialogBody key={props.lineItemId} {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveItemToGroupDialogBody({
  lineItemId,
  initialGroupId,
  categories,
  uncategorizedGroups,
  isPending,
  onClose,
  onSubmit,
}: MoveItemToGroupDialogProps) {
  // Flatten all groups with their owning category id so the picker
  // can label each option `<cat> > <group>` AND submit the right
  // categoryId without a second lookup. Uncategorized-zone groups
  // (categoryId === null) are appended so they're selectable targets too.
  const flatGroups = useMemo(
    () => [
      ...categories.flatMap((cat) =>
        cat.groups.map((g) => ({
          categoryId: cat.id as string | null,
          categoryName: cat.name,
          groupId: g.id,
          groupTitle: g.title,
        })),
      ),
      ...(uncategorizedGroups ?? []).map((g) => ({
        categoryId: null,
        categoryName: "Uncategorized",
        groupId: g.id,
        groupTitle: g.title,
      })),
    ],
    [categories, uncategorizedGroups],
  );

  const firstGroupId = flatGroups[0]?.groupId ?? "";
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    initialGroupId && flatGroups.some((g) => g.groupId === initialGroupId)
      ? initialGroupId
      : firstGroupId,
  );

  const hasGroups = flatGroups.length > 0;

  function handleSubmit() {
    if (!lineItemId) return;
    const picked = flatGroups.find((g) => g.groupId === selectedGroupId);
    if (!picked) return;
    onSubmit(lineItemId, {
      categoryId: picked.categoryId,
      groupId: picked.groupId,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move to group</DialogTitle>
        <DialogDescription>
          {hasGroups
            ? "Pick a group anywhere in the project. The item moves into the group and adopts its category."
            : "There are no groups in this project yet. Create a group first, then move items into it."}
        </DialogDescription>
      </DialogHeader>
      {hasGroups && (
        <div className="space-y-2 py-2">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {categories.map((cat) =>
              cat.groups.length > 0 ? (
                <optgroup key={cat.id} label={cat.name}>
                  {cat.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {cat.name} &gt; {g.title}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
            {uncategorizedGroups && uncategorizedGroups.length > 0 && (
              <optgroup label="Uncategorized">
                {uncategorizedGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    Uncategorized &gt; {g.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          {hasGroups ? "Cancel" : "Close"}
        </Button>
        {hasGroups && (
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

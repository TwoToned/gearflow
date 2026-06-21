"use client";

/**
 * Move-sub-hire-group dialog — picks a destination ProjectCategory
 * (or "Uncategorised") for a sub-hire group and routes to the Phase 5a
 * moveSubHireGroupToCategory server action.
 *
 * The destination picker is a ComboboxPicker rather than a plain Select
 * so the user can type a not-yet-existing category name and hit Enter
 * to trigger Section 8E.b: createCategoryAndPlaceGroup runs atomically
 * (new category + slot placement + sync of the synthetic parent line
 * item) and the dialog closes. Implements test plan item S15.
 */

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  moveSubHireGroupToCategory,
  createCategoryAndPlaceGroup,
} from "@/server/category-slots";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";

interface CategoryOption {
  id: string;
  name: string;
}

interface MoveSubHireGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sub-hire group id being moved. */
  groupId: string | null;
  /** Currently rendered title of the group (for the dialog header). */
  groupTitle?: string;
  /** Owning project id — needed for the "create category" branch so the
   *  new category is scoped to this project. */
  projectId: string;
  /** Project's categories — the destination picker offers these plus
   *  "Uncategorised". */
  categories: CategoryOption[];
  /** Parent-owned cache invalidation after a successful move. */
  onInvalidate: () => void;
}

const UNCATEGORISED_VALUE = "__uncategorised__";

export function MoveSubHireGroupDialog(props: MoveSubHireGroupDialogProps) {
  // Key the inner body by groupId so each fresh open of the dialog
  // resets the destination picker via mount, without a setState-in-effect.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <MoveSubHireGroupDialogBody key={props.groupId ?? "none"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function MoveSubHireGroupDialogBody({
  onOpenChange,
  groupId,
  groupTitle,
  projectId,
  categories,
  onInvalidate,
}: MoveSubHireGroupDialogProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(UNCATEGORISED_VALUE);

  function refreshCaches() {
    onInvalidate();
  }

  const moveMut = useServerMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error("No sub-hire group selected");
      const categoryId =
        selectedCategoryId === UNCATEGORISED_VALUE ? null : selectedCategoryId;
      return moveSubHireGroupToCategory({ groupId, categoryId });
    },
    onSuccess: () => {
      refreshCaches();
      toast.success(
        selectedCategoryId === UNCATEGORISED_VALUE
          ? "Moved sub-hire group to uncategorised"
          : "Moved sub-hire group",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useServerMutation({
    mutationFn: async (name: string) => {
      if (!groupId) throw new Error("No sub-hire group selected");
      return createCategoryAndPlaceGroup({
        projectId,
        name,
        slot: { subHireGroupId: groupId },
      });
    },
    onSuccess: (created) => {
      refreshCaches();
      // The action creates + places atomically, so we're done — close
      // the dialog. The new category lives at the end of the project's
      // category list per 8E.c.
      toast.success(`Created category "${(created as { name: string }).name}" and moved sub-hire group`);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handlePickValue(value: string) {
    // The picker only emits ids from its options list — the "Use '<name>'"
    // footer branch routes through handleCreate via the ComboboxPicker's
    // creatable + onChange semantics. If somehow a non-id falls through,
    // treat it as a create intent.
    const matched = categories.find((c) => c.id === value);
    if (matched || value === UNCATEGORISED_VALUE) {
      setSelectedCategoryId(value);
      return;
    }
    // Fall-through: treat as create-by-name.
    createMut.mutate(value);
  }

  const isPending = moveMut.isPending || createMut.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {groupTitle ? `Move "${groupTitle}"` : "Move sub-hire group"}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>Destination category</Label>
          <ComboboxPicker
            value={selectedCategoryId}
            onChange={handlePickValue}
            options={[
              { value: UNCATEGORISED_VALUE, label: "Uncategorised" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            placeholder="Select or type to create"
            searchPlaceholder="Search categories or type a new name..."
            emptyMessage="No matching category."
            creatable
          />
          <p className="text-xs text-fg-3">
            Type a new name and press Enter to create the category and move
            this group into it.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="line" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={() => moveMut.mutate()}
          disabled={isPending || !groupId}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Move
        </Button>
      </DialogFooter>
    </>
  );
}

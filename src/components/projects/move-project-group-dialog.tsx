"use client";

/**
 * Move-project-group dialog — picks a destination ProjectCategory for a
 * ProjectGroup and routes to moveProjectGroupToCategory.
 *
 * Mirrors MoveSubHireGroupDialog but with two differences:
 *   - No "Uncategorised" option — ProjectGroup.categoryId is NOT NULL
 *     in the schema, so every project group MUST live in a category.
 *   - Permission gate is project-only (sub-hire move requires both
 *     project + sub-hire perms).
 *
 * The destination picker is a ComboboxPicker rather than a plain Select
 * so the user can type a new category name and hit Enter to trigger
 * createCategoryAndPlaceGroup (atomic create + slot placement),
 * matching the sub-hire flow's S15.
 */

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  moveProjectGroupToCategory,
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

const UNCATEGORISED_VALUE = "__uncategorised__";

interface CategoryOption {
  id: string;
  name: string;
}

interface MoveProjectGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project group id being moved. */
  groupId: string | null;
  /** Currently rendered title of the group (for the dialog header). */
  groupTitle?: string;
  /** Owning project id — needed for the "create category" branch so the
   *  new category is scoped to this project. */
  projectId: string;
  /** Project's categories — the destination picker offers these (no
   *  "Uncategorised" option, see schema note above). */
  categories: CategoryOption[];
  /** Parent-owned cache invalidation after a successful move. */
  onInvalidate: () => void;
}

export function MoveProjectGroupDialog(props: MoveProjectGroupDialogProps) {
  // Key the body by groupId so each fresh open resets the destination
  // picker via mount, not via setState-in-effect.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <MoveProjectGroupDialogBody key={props.groupId ?? "none"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function MoveProjectGroupDialogBody({
  onOpenChange,
  groupId,
  groupTitle,
  projectId,
  categories,
  onInvalidate,
}: MoveProjectGroupDialogProps) {
  // Seed with Uncategorised — a meaningful default that doesn't
  // require the user to remember which category they picked last.
  // Picking a category from the dropdown still lets them move into
  // a specific destination; typing a new name routes to create-by-name.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(UNCATEGORISED_VALUE);

  function refreshCaches() {
    onInvalidate();
  }

  const moveMut = useServerMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error("No project group selected");
      if (!selectedCategoryId) throw new Error("Pick a destination");
      return moveProjectGroupToCategory({
        groupId,
        categoryId:
          selectedCategoryId === UNCATEGORISED_VALUE ? null : selectedCategoryId,
      });
    },
    onSuccess: () => {
      refreshCaches();
      toast.success(
        selectedCategoryId === UNCATEGORISED_VALUE
          ? "Moved group to uncategorised"
          : "Moved group",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useServerMutation({
    mutationFn: async (name: string) => {
      if (!groupId) throw new Error("No project group selected");
      return createCategoryAndPlaceGroup({
        projectId,
        name,
        slot: { projectGroupId: groupId },
      });
    },
    onSuccess: (created) => {
      refreshCaches();
      toast.success(
        `Created category "${(created as { name: string }).name}" and moved group`,
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handlePickValue(value: string) {
    // ComboboxPicker emits ids from its options list; the creatable
    // footer routes typed-but-unmatched text here as a create intent.
    const matched = categories.find((c) => c.id === value);
    if (matched || value === UNCATEGORISED_VALUE) {
      setSelectedCategoryId(value);
      return;
    }
    createMut.mutate(value);
  }

  const isPending = moveMut.isPending || createMut.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {groupTitle ? `Move "${groupTitle}"` : "Move group"}
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
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={() => moveMut.mutate()}
          disabled={isPending || !groupId || !selectedCategoryId}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Move
        </Button>
      </DialogFooter>
    </>
  );
}

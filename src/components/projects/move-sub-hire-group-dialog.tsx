"use client";

/**
 * Move-sub-hire-group dialog — picks a destination ProjectCategory
 * (or "Uncategorised") for a sub-hire group and routes to the Phase 5a
 * moveSubHireGroupToCategory server action.
 *
 * Mirrors the kebab "Move" action that LineItemRow / GroupRow already
 * surface, so the kebab on a sub-hire group row points at a real flow
 * instead of a stub. Used by Phase 6b to complete the symmetric kebab
 * promise from the cross-type unification plan.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { moveSubHireGroupToCategory } from "@/server/category-slots";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  categories,
  onInvalidate,
}: MoveSubHireGroupDialogProps) {
  const queryClient = useQueryClient();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(UNCATEGORISED_VALUE);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error("No sub-hire group selected");
      const categoryId =
        selectedCategoryId === UNCATEGORISED_VALUE ? null : selectedCategoryId;
      return moveSubHireGroupToCategory({ groupId, categoryId });
    },
    onSuccess: () => {
      onInvalidate();
      queryClient.invalidateQueries({ queryKey: ["project-categories"] });
      queryClient.invalidateQueries({ queryKey: ["uncategorized-subhire-groups"] });
      toast.success(
        selectedCategoryId === UNCATEGORISED_VALUE
          ? "Moved sub-hire group to uncategorised"
          : "Moved sub-hire group",
      );
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedLabel =
    selectedCategoryId === UNCATEGORISED_VALUE
      ? "Uncategorised"
      : categories.find((c) => c.id === selectedCategoryId)?.name ?? "Uncategorised";

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
          <Select value={selectedCategoryId} onValueChange={(v) => setSelectedCategoryId(v ?? UNCATEGORISED_VALUE)}>
            <SelectTrigger>
              <SelectValue placeholder="Select a category">
                {selectedLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNCATEGORISED_VALUE}>Uncategorised</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !groupId}
        >
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Move
        </Button>
      </DialogFooter>
    </>
  );
}

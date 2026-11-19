"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { relocateAccessories, takeAccessorySelection } from "@/components/warehouse/relocate-accessories";
import {
  isMoveableAtDeployStage,
  isMoveableAtDeprepStage,
  isMoveableAtReturnStage,
  resolveSelectionToUnitIds,
} from "@/components/warehouse/warehouse-types";

type MoveFor = "deploy" | "deprep" | "return";
const none = () => new Set<string>();

/**
 * "Move to case…" (#1296 phase 2): reassign a Prepped / Out / Returned selection to another container.
 * `moveDialogFor` names which stage's own selection set + predicate the dialog resolves against (they
 * differ: a bulk unit's `isRelevant` depends on the stage). Resolving happens once, before opening.
 */
export function useMoveToCase(placed: ReturnType<typeof relocateAccessories>) {
  const [selectedOut, setSelectedOut] = useState<Set<string>>(none);
  const [selectedIn, setSelectedIn] = useState<Set<string>>(none);
  const [selectedDeprep, setSelectedDeprep] = useState<Set<string>>(none);
  const [moveDialogFor, setMoveDialogFor] = useState<MoveFor | null>(null);
  const [moveIsPending, setMoveIsPending] = useState(false);
  const containerWrites = useProjectContainerWrites();
  /** Post-write reset of the legacy selection sets (the native subscription refreshes the data itself). */
  const invalidate = useCallback(() => { setSelectedOut(none()); setSelectedIn(none()); }, []);

  const moveDialogUnitIds = useMemo(() => {
    // Accessory keys name their own units; everything else resolves against `placed.items`.
    const resolve = (keys: Set<string>, isRelevant: Parameters<typeof resolveSelectionToUnitIds>[2]) => {
      const { rest, unitIds } = takeAccessorySelection(keys, placed, isRelevant);
      return [...new Set([...unitIds, ...resolveSelectionToUnitIds(new Set(rest), placed.items, isRelevant)])];
    };
    if (moveDialogFor === "deploy") return resolve(selectedOut, isMoveableAtDeployStage);
    if (moveDialogFor === "deprep") return resolve(selectedDeprep, isMoveableAtDeprepStage);
    if (moveDialogFor === "return") return resolve(selectedIn, isMoveableAtReturnStage);
    return [];
  }, [moveDialogFor, selectedOut, selectedDeprep, selectedIn, placed]);

  const handleConfirmMove = async (toContainerId: string | null) => {
    const forTab = moveDialogFor;
    if (moveDialogUnitIds.length === 0 || !forTab) return;
    setMoveIsPending(true);
    try {
      const { moved } = await containerWrites.moveUnits(moveDialogUnitIds, toContainerId);
      toast.success(`Moved ${moved} item${moved === 1 ? "" : "s"}`);
      ({ deploy: setSelectedOut, deprep: setSelectedDeprep, return: setSelectedIn })[forTab](none());
      setMoveDialogFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move");
    } finally {
      setMoveIsPending(false);
    }
  };

  return {
    setSelectedOut, setSelectedIn, setSelectedDeprep, moveDialogFor, setMoveDialogFor, moveIsPending,
    moveDialogUnitIds, handleConfirmMove, invalidate,
    clear: { out: () => setSelectedOut(none()), in: () => setSelectedIn(none()), deprep: () => setSelectedDeprep(none()) },
  };
}

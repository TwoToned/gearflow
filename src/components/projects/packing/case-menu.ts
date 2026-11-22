import type { RealContainer } from "@/hooks/use-packing-tab";
import type { usePackingCaseWrites } from "@/hooks/use-packing-case-writes";
import { caseAndDescendantIds, caseCardFacts } from "@/lib/packing-tab";
import { buildPackingCaseActions } from "@/lib/row-actions/packing-case";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { CARD_COLLAPSED_LINES } from "./case-card";
import type { CaseBucket } from "./packing-board";

export type CaseRef = { id: string; label: string };

/**
 * One case card's ⋯: gathers the case's relations (its container row, the case
 * it sits in), the "Move into" targets (every other case except itself, its
 * descendants and its current parent; the server's cycle check is the
 * authority) and its facts, then hands them to `buildPackingCaseActions`.
 */
export function buildCaseMenu(args: {
  bucket: CaseBucket;
  expanded: boolean;
  setExpanded: (on: boolean) => void;
  containers: readonly RealContainer[];
  caseWrites: ReturnType<typeof usePackingCaseWrites>;
  /** THE planning write: Unpack is `planInto(plannedOnlyIds, null)`, not a second caller of the mutation. */
  planInto: (ids: readonly string[], target: CaseRef | null, opts?: { packedStay?: number }) => Promise<unknown>;
  onRename: (c: CaseRef) => void;
}): ActionMenuSpec {
  const { bucket, expanded, setExpanded, containers, caseWrites, planInto, onRename } = args;
  const unplan = (ids: readonly string[], packedStay: number) => planInto(ids, null, { packedStay });
  const me = containers.find((c) => c.id === bucket.containerId);
  const self: CaseRef = { id: bucket.containerId, label: bucket.label ?? me?.label ?? "Case" };
  const parentDoc = me?.parentContainerId ? containers.find((c) => c.id === me.parentContainerId) : undefined;
  const parent = parentDoc ? { id: parentDoc.id, label: parentDoc.label, sealed: parentDoc.sealedAt != null } : null;
  const facts = caseCardFacts(bucket);
  const excluded = caseAndDescendantIds(containers, self.id);
  // A sealed case refuses having a case packed into it (server: CASE_SEALED), so it is no target.
  const moveTargets = containers
    .filter((c) => !excluded.has(c.id) && c.id !== parent?.id && c.sealedAt == null)
    .map((c) => ({ id: c.id, label: c.label }));
  return buildPackingCaseActions(
    {
      ...self,
      parent,
      hasNestedCase: containers.some((c) => c.parentContainerId === self.id),
      plannedOnlyCount: facts.plannedOnlyIds.length,
      sealed: me?.sealedAt != null,
      hiddenLineCount: Math.max(0, bucket.lines.length - CARD_COLLAPSED_LINES),
      expanded,
      packedCount: facts.packedCount,
    },
    {
      moveTargets,
      onRename: () => onRename(self),
      onMoveInto: (targetId) => {
        const target = moveTargets.find((c) => c.id === targetId);
        if (target) void caseWrites.moveInto(self, target, parent && { id: parent.id, label: parent.label });
      },
      onTakeOut: parent ? () => void caseWrites.takeOut(self, { id: parent.id, label: parent.label }) : undefined,
      onUnpack: () => void unplan(facts.plannedOnlyIds, facts.packedCount),
      onPrintLabel: () => caseWrites.printLabel(self),
      onSeal: () => void caseWrites.seal(self),
      onUnseal: () => void caseWrites.unseal(self),
      onToggleExpanded: () => setExpanded(!expanded),
      onDelete: () => void caseWrites.remove({ ...self, kind: me?.kind }),
    },
  );
}

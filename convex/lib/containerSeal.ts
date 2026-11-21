import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/**
 * UX Phase 8 (D21) — the ONE seal check. A sealed case (`sealedAt` set) is a
 * planning lock: nothing may be planned into it, and nothing planned in it may
 * be planned out, until it is unsealed. Every write that must respect a seal
 * calls this helper so the rule (and the error code the UI maps) lives in one
 * place. Callers: the plan writes (`setPlannedContainerNative`) and, per the
 * owner's Q3 decision, rename / re-nest (`updateNative`) and delete
 * (`deleteNative`) of the case itself. A seal does NOT block warehouse prep or
 * unit moves (Q7, owner-decided): packers are the physical truth.
 */
export function isContainerSealed(container: Pick<Doc<"projectContainers">, "sealedAt">): boolean {
  return container.sealedAt != null;
}

export function assertContainerNotSealed(container: Pick<Doc<"projectContainers">, "label" | "sealedAt">, verb: string): void {
  if (!isContainerSealed(container)) return;
  throw new ConvexError({
    code: "CASE_SEALED",
    message: `${container.label} is sealed. Unseal it to ${verb}.`,
  });
}

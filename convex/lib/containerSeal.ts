import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/**
 * UX Phase 8 (D21) — the ONE seal check. A sealed case (`sealedAt` set) is a
 * planning lock: nothing may be planned into it, and nothing planned in it may
 * be planned out, until it is unsealed. Every write that must respect a seal
 * calls this helper so the rule (and the error code the UI maps) lives in one
 * place. Today only the plan writes call it; whether rename / re-nest / delete
 * also honour a seal is an open owner decision (Q3) — when it is a yes, each is
 * a one-line call here.
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

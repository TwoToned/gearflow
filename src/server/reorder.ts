"use server";

/**
 * Reorder dashboard server actions (Wave 3).
 *
 * Thin wrappers around the pure helpers in `src/lib/reorder.ts`.
 *
 * Permission policy: `bulkAsset` for read (you have to be allowed to see
 * stock to see what's low), `supplier` for create (you're creating a draft
 * supplier order — the supplier resource owns that surface today).
 */

import { requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  getReorderCandidatesCore,
  createReorderDraftCore,
  type ReorderCandidate,
  type ReorderDraftLine,
} from "@/lib/reorder";

export type { ReorderCandidate };

export async function getReorderCandidates() {
  const { organizationId } = await requirePermission("bulkAsset", "read");
  const candidates = await getReorderCandidatesCore(organizationId);
  return serialize(candidates);
}

export async function createReorderDraft(input: {
  supplierId: string;
  lines: ReorderDraftLine[];
  notes?: string;
}) {
  const { organizationId, userId, userName } = await requirePermission(
    "supplier",
    "create",
  );

  const result = await createReorderDraftCore({
    organizationId,
    userId,
    supplierId: input.supplierId,
    lines: input.lines,
    notes: input.notes,
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "supplierOrder",
    entityId: result.id,
    entityName: result.orderNumber,
    summary: `Created reorder draft ${result.orderNumber} (${result.lineCount} line${result.lineCount === 1 ? "" : "s"})`,
    details: { source: "reorder-dashboard", lineCount: result.lineCount },
  });

  return serialize(result);
}

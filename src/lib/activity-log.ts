import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nativeActivityWrites } from "@/lib/native-writes";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

interface LogActivityInput {
  organizationId: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  summary: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  projectId?: string;
  assetId?: string;
  kitId?: string;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  // One shared id + timestamp so the Postgres row and the Convex mirror row match
  // exactly (the mirror is idempotent by this cuid).
  const id = createId();
  const createdAt = new Date();

  // Postgres write (unchanged behaviour — best-effort, never throws).
  try {
    await prisma.activityLog.create({
      data: {
        id,
        createdAt,
        ...input,
        details: input.details as unknown as Prisma.InputJsonValue,
        metadata: input.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }

  // Phase 5c: mirror into Convex `activityLogs` so the activity-log screens can read
  // natively with the COMPLETE cross-domain history. Best-effort — audit must never
  // break a write. The 5 inverted domains write Convex atomically in-mutation and skip
  // logActivity, so there's no double-count.
  if (nativeActivityWrites()) {
    try {
      const convex = await getConvexClient();
      await convex.mutation(api.activityLogWrites.record, {
        id,
        organizationId: input.organizationId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityName: input.entityName,
        userId: input.userId,
        userName: input.userName,
        summary: input.summary,
        details: input.details,
        metadata: input.metadata,
        projectId: input.projectId,
        assetId: input.assetId,
        kitId: input.kitId,
        createdAt: createdAt.getTime(),
      });
    } catch (error) {
      console.error("Failed to mirror activity to Convex:", error);
    }
  }
}

/**
 * Batched sibling of {@link logActivity}: write N audit rows in ONE Postgres insert
 * + ONE Convex mirror mutation instead of N sequential round-trips. Use from bulk
 * warehouse actions (check-out / return / prep / deprep of a batch) that previously
 * looped `await logActivity(...)` per item — the dominant tax on those paths. Each
 * input still produces exactly one audit row (per-item granularity preserved); only
 * the transport is batched. Best-effort, like logActivity — audit never breaks a write.
 */
export async function logActivityMany(inputs: LogActivityInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const createdAt = new Date();
  const rows = inputs.map((input) => ({ id: createId(), createdAt, ...input }));

  // ONE Postgres insert for all N rows (was N sequential creates).
  try {
    await prisma.activityLog.createMany({
      data: rows.map((r) => ({
        ...r,
        details: r.details as unknown as Prisma.InputJsonValue,
        metadata: r.metadata as unknown as Prisma.InputJsonValue,
      })),
    });
  } catch (error) {
    console.error("Failed to log activity batch:", error);
  }

  // ONE Convex mirror mutation for all N (was N sequential `record` calls).
  if (nativeActivityWrites()) {
    try {
      const convex = await getConvexClient();
      await convex.mutation(api.activityLogWrites.recordMany, {
        rows: rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          entityName: r.entityName,
          userId: r.userId,
          userName: r.userName,
          summary: r.summary,
          details: r.details,
          metadata: r.metadata,
          projectId: r.projectId,
          assetId: r.assetId,
          kitId: r.kitId,
          createdAt: r.createdAt.getTime(),
        })),
      });
    } catch (error) {
      console.error("Failed to mirror activity batch to Convex:", error);
    }
  }
}

export function buildChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
  labels?: Record<string, Record<string, string>>
): Array<{ field: string; from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> {
  const changes: Array<{ field: string; from: unknown; to: unknown; fromLabel?: string; toLabel?: string }> = [];
  for (const field of fields) {
    const fromVal = before[field] ?? null;
    const toVal = after[field] ?? null;
    if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      const change: { field: string; from: unknown; to: unknown; fromLabel?: string; toLabel?: string } = {
        field,
        from: fromVal,
        to: toVal,
      };
      if (labels?.[field]) {
        if (typeof fromVal === "string" && labels[field][fromVal]) {
          change.fromLabel = labels[field][fromVal];
        }
        if (typeof toVal === "string" && labels[field][toVal]) {
          change.toLabel = labels[field][toVal];
        }
      }
      changes.push(change);
    }
  }
  return changes;
}

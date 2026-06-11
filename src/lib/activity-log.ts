import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

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
  try {
    await prisma.activityLog.create({
      data: {
        ...input,
        details: input.details as unknown as Prisma.InputJsonValue,
        metadata: input.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
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

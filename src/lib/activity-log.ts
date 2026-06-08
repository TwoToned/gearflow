import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { events } from "@/lib/events";

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

function mapEntityTypeToEvent(
  entityType: string,
  action: string
): string | null {
  switch (entityType) {
    case "Project":
      return action === "created" ? "project:created" : "project:updated";
    case "ProjectLineItem":
      return "line-item:changed";
    case "Asset":
      return action === "created" ? "asset:created" : "asset:updated";
    case "Kit":
      return action === "created" ? "kit:created" : "kit:updated";
    case "MaintenanceRecord":
      return "maintenance:changed";
    case "WarehouseOperation":
      return "warehouse:changed";
    case "CrewMember":
      return "crew:changed";
    default:
      return null;
  }
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

    try {
      const eventType = mapEntityTypeToEvent(input.entityType, input.action);
      if (eventType) {
        const payload: Record<string, string | undefined> = {
          orgId: input.organizationId,
          actorId: input.userId,
        };
        if (input.projectId) payload.projectId = input.projectId;
        if (input.assetId) payload.assetId = input.assetId;
        if (input.kitId) payload.kitId = input.kitId;

        events.emit(eventType as never, payload as never);
      }
    } catch (e) {
      console.error("Failed to emit realtime event:", e);
    }
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

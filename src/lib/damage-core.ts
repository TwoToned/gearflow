/**
 * Pure damage-event creation logic. Lives outside `"use server"` so the
 * integration tests can drive the full happy path (including the linked
 * MaintenanceRecord side effect) without faking a request scope.
 *
 * The "use server" wrapper at `src/server/damage.ts` resolves the
 * organisation + actor context, then delegates here.
 */

import { prisma } from "@/lib/prisma";
import { translatePrismaError } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";
import type { DamageEventCreateInput } from "@/lib/validations/damage";

export interface DamageCreateContext {
  organizationId: string;
  userId: string;
}

export async function createDamageEventCore(
  parsed: Required<
    Pick<DamageEventCreateInput, "severity" | "notes">
  > &
    Omit<DamageEventCreateInput, "severity" | "notes">,
  ctx: DamageCreateContext,
) {
  const { organizationId, userId } = ctx;

  try {
    return await prisma.$transaction(async (tx) => {
      const photos = (parsed.photos as string[] | undefined) ?? [];
      let maintenanceRecordId: string | null = null;
      const needsRepair =
        (parsed.createMaintenanceRecord ?? true) &&
        parsed.severity !== "MINOR" &&
        (parsed.assetId || parsed.bulkAssetId);

      if (needsRepair) {
        const mr = await tx.maintenanceRecord.create({
          data: {
            organizationId,
            projectId: parsed.projectId ?? null,
            type: "REPAIR",
            status: "SCHEDULED",
            title: `Damage repair — ${parsed.severity.toLowerCase()}`,
            description: parsed.notes,
            cost: parsed.estimatedCost ?? null,
            reportedById: userId,
          },
        });
        maintenanceRecordId = mr.id;

        if (parsed.assetId) {
          await tx.maintenanceRecordAsset.create({
            data: { maintenanceRecordId: mr.id, assetId: parsed.assetId },
          });
        }
      }

      const event = await tx.damageEvent.create({
        data: {
          organizationId,
          projectId: parsed.projectId ?? null,
          lineItemId: parsed.lineItemId ?? null,
          assetId: parsed.assetId ?? null,
          bulkAssetId: parsed.bulkAssetId ?? null,
          severity: parsed.severity,
          status: "OPEN",
          notes: parsed.notes,
          photos,
          estimatedCost: parsed.estimatedCost ?? null,
          actualCost: parsed.actualCost ?? null,
          chargedBack: parsed.chargedBack ?? false,
          maintenanceRecordId,
          createdById: userId,
        },
      });
      return event;
    });
  } catch (e) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

export interface DamageUpdateInput {
  severity?: "MINOR" | "MAJOR" | "TOTAL";
  status?: "OPEN" | "UNDER_REPAIR" | "RESOLVED" | "CHARGED_BACK";
  notes?: string;
  photos?: string[];
  estimatedCost?: number | null;
  actualCost?: number | null;
  chargedBack?: boolean;
}

export async function updateDamageEventCore(
  id: string,
  organizationId: string,
  patch: DamageUpdateInput,
) {
  const data: Prisma.DamageEventUpdateInput = {};
  if (patch.severity != null) data.severity = patch.severity;
  if (patch.status != null) data.status = patch.status;
  if (patch.notes != null) data.notes = patch.notes;
  if (patch.photos != null) data.photos = patch.photos;
  if (patch.estimatedCost !== undefined) data.estimatedCost = patch.estimatedCost;
  if (patch.actualCost !== undefined) data.actualCost = patch.actualCost;
  if (patch.chargedBack != null) data.chargedBack = patch.chargedBack;

  try {
    return await prisma.damageEvent.update({
      where: { id, organizationId },
      data,
    });
  } catch (e) {
    const translated = translatePrismaError(e);
    if (translated) throw translated;
    throw e;
  }
}

"use server";

/**
 * Damage capture server actions (Wave 3).
 *
 * Permission policy: piggyback on `maintenance` — the same workshop staff
 * who triage repairs are the ones who report damage on returning items.
 * No separate "damage" resource (would just duplicate the matrix).
 *
 * The pure write logic lives in `src/lib/damage-core.ts` so integration
 * tests can drive the full create path (including the linked
 * MaintenanceRecord side effect) without faking a request scope.
 *
 * Charged-back damage is intentionally NOT auto-pushed to Xero. The ops
 * user marks `chargedBack: true` after the client agrees the charge —
 * that flips the cost off our P&L in the panel and is the audit signal
 * for the bookkeeper to add the line in Xero.
 */

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  damageEventCreateSchema,
  damageEventUpdateSchema,
  damageListFiltersSchema,
  type DamageEventCreateInput,
  type DamageEventUpdateInput,
  type DamageListFilters,
} from "@/lib/validations/damage";
import {
  createDamageEventCore,
  updateDamageEventCore,
} from "@/lib/damage-core";
import { mirrorDamageCreate, patchDamageInConvex } from "@/lib/damage-mirror";
import { syncMaintenanceToConvex } from "@/lib/maintenance-mirror";
import { UserFacingError } from "@/lib/errors";
import { getModelMap } from "@/lib/models-read";
import type { Prisma } from "@/generated/prisma/client";

/** Graft the Convex model doc onto a damage event's asset + bulkAsset. */
async function attachDamageModels<T>(organizationId: string, events: T[]): Promise<T[]> {
  const modelMap = await getModelMap(organizationId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graft = (a: any) =>
    a ? { ...a, model: a.modelId ? modelMap.get(a.modelId) ?? null : null } : a;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return events.map((e: any) => ({ ...e, asset: graft(e.asset), bulkAsset: graft(e.bulkAsset) }));
}

/** Create a damage event. Optionally creates a linked MaintenanceRecord
 *  so the asset hold/release state machine fires automatically. */
export async function createDamageEvent(input: DamageEventCreateInput) {
  const { organizationId, userId, userName } = await requirePermission(
    "maintenance",
    "create",
  );
  const parsed = damageEventCreateSchema.parse(input);

  // Resolve the entity tag for activity-log summary.
  let entityLabel = "an item";
  if (parsed.assetId) {
    const asset = await prisma.asset.findUnique({
      where: { id: parsed.assetId, organizationId },
      select: { assetTag: true },
    });
    if (asset) entityLabel = `asset ${asset.assetTag}`;
  } else if (parsed.bulkAssetId) {
    const bulk = await prisma.bulkAsset.findUnique({
      where: { id: parsed.bulkAssetId, organizationId },
      select: { assetTag: true },
    });
    if (bulk) entityLabel = `bulk asset ${bulk.assetTag}`;
  } else if (parsed.lineItemId) {
    entityLabel = "a line item";
  }

  const result = await createDamageEventCore(parsed, {
    organizationId,
    userId,
  });

  await mirrorDamageCreate(result as unknown as Record<string, unknown>);
  // createDamageEventCore may spawn a linked repair MaintenanceRecord — mirror it too.
  if ((result as { maintenanceRecordId?: string | null }).maintenanceRecordId) {
    await syncMaintenanceToConvex((result as { maintenanceRecordId?: string | null }).maintenanceRecordId);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "damageEvent",
    entityId: result.id,
    entityName: `${parsed.severity} damage on ${entityLabel}`,
    summary: `Reported ${parsed.severity.toLowerCase()} damage on ${entityLabel}`,
    projectId: parsed.projectId ?? undefined,
    assetId: parsed.assetId ?? undefined,
    details: { severity: parsed.severity, hasPhotos: parsed.photos.length > 0 },
  });

  return serialize(result);
}

export async function updateDamageEvent(id: string, input: DamageEventUpdateInput) {
  const { organizationId, userId, userName } = await requirePermission(
    "maintenance",
    "update",
  );
  const parsed = damageEventUpdateSchema.parse(input);

  const existing = await prisma.damageEvent.findUnique({
    where: { id, organizationId },
    select: { status: true, chargedBack: true, severity: true },
  });
  if (!existing) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Damage event not found",
      message: "This record was deleted or moved. Refresh the page.",
    });
  }

  const updated = await updateDamageEventCore(id, organizationId, parsed);

  await patchDamageInConvex(id, updated as unknown as Record<string, unknown>);

  const changes: string[] = [];
  if (parsed.status && parsed.status !== existing.status) {
    changes.push(`status ${existing.status} → ${parsed.status}`);
  }
  if (parsed.chargedBack != null && parsed.chargedBack !== existing.chargedBack) {
    changes.push(parsed.chargedBack ? "charged back to client" : "charge-back removed");
  }
  if (parsed.actualCost != null) {
    changes.push(`actual cost set to $${parsed.actualCost}`);
  }

  if (changes.length > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "damageEvent",
      entityId: id,
      entityName: `${existing.severity} damage`,
      summary: changes.join(", "),
    });
  }

  return serialize(updated);
}

export async function listDamageEvents(filters: DamageListFilters = {}) {
  const { organizationId } = await requirePermission("maintenance", "read");
  const parsed = damageListFiltersSchema.parse(filters);

  const where: Prisma.DamageEventWhereInput = { organizationId };
  if (parsed.status) where.status = parsed.status;
  if (parsed.severity) where.severity = parsed.severity;
  if (parsed.projectId) where.projectId = parsed.projectId;
  if (parsed.search) {
    where.OR = [
      { notes: { contains: parsed.search, mode: "insensitive" } },
      { asset: { assetTag: { contains: parsed.search, mode: "insensitive" } } },
      { bulkAsset: { assetTag: { contains: parsed.search, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.damageEvent.findMany({
      where,
      include: {
        asset: { select: { id: true, assetTag: true, customName: true, modelId: true } },
        bulkAsset: { select: { id: true, assetTag: true, modelId: true } },
        project: { select: { id: true, projectNumber: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (parsed.page - 1) * parsed.pageSize,
      take: parsed.pageSize,
    }),
    prisma.damageEvent.count({ where }),
  ]);

  return serialize({
    items: await attachDamageModels(organizationId, items),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
    totalPages: Math.ceil(total / parsed.pageSize),
  });
}

export async function getDamageEvent(id: string) {
  const { organizationId } = await requirePermission("maintenance", "read");
  const item = await prisma.damageEvent.findUnique({
    where: { id, organizationId },
    include: {
      asset: { select: { id: true, assetTag: true, customName: true, modelId: true } },
      bulkAsset: { select: { id: true, assetTag: true, modelId: true } },
      lineItem: { select: { id: true, description: true } },
      project: { select: { id: true, projectNumber: true, name: true } },
      maintenanceRecord: { select: { id: true, status: true, title: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!item) {
    throw new UserFacingError({
      code: "NOT_FOUND",
      title: "Damage event not found",
      message: "This record was deleted or moved.",
    });
  }
  const [grafted] = await attachDamageModels(organizationId, [item]);
  return serialize(grafted);
}

export async function chargeBackDamage(id: string, chargedBack: boolean) {
  return updateDamageEvent(id, { chargedBack });
}

export async function resolveDamage(id: string, actualCost?: number) {
  return updateDamageEvent(id, {
    status: "RESOLVED",
    actualCost: actualCost ?? null,
  });
}

export async function getProjectDamageSummary(projectId: string) {
  const { organizationId } = await getOrgContext();
  const rows = await prisma.damageEvent.findMany({
    where: { projectId, organizationId },
    select: {
      id: true,
      severity: true,
      status: true,
      actualCost: true,
      estimatedCost: true,
      chargedBack: true,
    },
  });
  return serialize(rows);
}

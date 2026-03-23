"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import type { Prisma } from "@/generated/prisma/client";
import {
  completeCheckAndPackSchema,
  type CompleteCheckAndPackValues,
  completeCheckAndFlagSchema,
  type CompleteCheckAndFlagValues,
  completeCheckAndStoreSchema,
  type CompleteCheckAndStoreValues,
  submitChecksSchema,
  type SubmitChecksFormValues,
  type CheckRecordFormValues,
} from "@/lib/validations/check-item";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function saveCheckRecords(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  assetId: string,
  lineItemId: string | undefined | null,
  bulkAssetId: string | undefined | null,
  context: "PREP" | "RETURN" | "AD_HOC",
  checks: CheckRecordFormValues[]
) {
  // Fetch check item details for snapshots
  const checkItemIds = checks.map((c) => c.checkItemId);
  const checkItems = await tx.checkItem.findMany({
    where: { id: { in: checkItemIds }, organizationId },
    select: { id: true, label: true, type: true },
  });
  const checkItemMap = new Map(checkItems.map((ci) => [ci.id, ci]));

  const records = [];
  for (const check of checks) {
    const ci = checkItemMap.get(check.checkItemId);
    if (!ci) {
      throw new Error(`Check item ${check.checkItemId} not found`);
    }

    records.push(
      await tx.checkRecord.create({
        data: {
          organizationId,
          context,
          lineItemId: lineItemId || null,
          assetId,
          bulkAssetId: bulkAssetId || null,
          checkItemId: check.checkItemId,
          checkItemLabelSnapshot: ci.label,
          checkItemTypeSnapshot: ci.type,
          result: check.result,
          value: check.value || null,
          notes: check.notes || null,
          photos: check.photos || [],
          performedById: userId,
        },
      })
    );
  }

  return records;
}

/** After saving FAIL records, check if predictive maintenance should trigger */
async function checkPredictiveMaintenance(
  organizationId: string,
  userId: string,
  userName: string,
  assetId: string,
  failedCheckItemIds: string[]
) {
  for (const checkItemId of failedCheckItemIds) {
    // Get last 3 check records for this asset + check item
    const recentRecords = await prisma.checkRecord.findMany({
      where: { organizationId, assetId, checkItemId },
      orderBy: { performedAt: "desc" },
      take: 3,
      select: { result: true },
    });

    const failCount = recentRecords.filter((r) => r.result === "FAIL").length;

    if (failCount >= 2) {
      // Get asset and check item details for the maintenance record
      const [asset, checkItem] = await Promise.all([
        prisma.asset.findUnique({
          where: { id: assetId },
          select: { assetTag: true, modelId: true, model: { select: { name: true } } },
        }),
        prisma.checkItem.findUnique({
          where: { id: checkItemId },
          select: { label: true },
        }),
      ]);

      if (!asset || !checkItem) continue;

      // Check if a maintenance record already exists for this pattern (avoid duplicates)
      const existingMaintenance = await prisma.maintenanceRecord.findFirst({
        where: {
          organizationId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          title: { contains: `[Auto] ${checkItem.label}` },
          assets: { some: { assetId } },
        },
      });

      if (!existingMaintenance) {
        const maintenance = await prisma.maintenanceRecord.create({
          data: {
            organizationId,
            type: "PREVENTATIVE",
            status: "SCHEDULED",
            title: `[Auto] ${checkItem.label} — ${asset.assetTag}`,
            description: `Automatically created: "${checkItem.label}" failed ${failCount} of last ${recentRecords.length} checks on ${asset.model.name} (${asset.assetTag}).`,
            reportedById: userId,
            scheduledDate: new Date(),
          },
        });

        await prisma.maintenanceRecordAsset.create({
          data: {
            maintenanceRecordId: maintenance.id,
            assetId,
          },
        });

        await logActivity({
          organizationId,
          userId,
          userName,
          action: "CREATE",
          entityType: "maintenance",
          entityId: maintenance.id,
          entityName: maintenance.title,
          summary: `Auto-created maintenance for repeated check failure`,
          assetId,
        });
      }
    }
  }
}

// ─── Pull / Unpack (intermediate status before check form) ──────────────────

export async function pullItem(projectId: string, lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );

  const lineItem = await prisma.projectLineItem.findFirst({
    where: { id: lineItemId, projectId, organizationId },
    include: { model: true },
  });

  if (!lineItem) {
    throw new Error("Line item not found in project");
  }

  const result = await prisma.projectLineItem.update({
    where: { id: lineItemId },
    data: { prepStatus: "PULLED" },
    include: { model: true, asset: true, bulkAsset: true },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: lineItem.model?.name || `Line item`,
    summary: `Pulled item for prep check`,
    projectId,
    assetId: lineItem.assetId || undefined,
  });

  return serialize(result);
}

export async function unpackItem(projectId: string, lineItemId: string) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in"
  );

  const lineItem = await prisma.projectLineItem.findFirst({
    where: { id: lineItemId, projectId, organizationId },
    include: { model: true },
  });

  if (!lineItem) {
    throw new Error("Line item not found in project");
  }

  const result = await prisma.projectLineItem.update({
    where: { id: lineItemId },
    data: { returnStatus: "UNPACKED" },
    include: { model: true, asset: true, bulkAsset: true },
  });

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: lineItemId,
    entityName: lineItem.model?.name || `Line item`,
    summary: `Unpacked item for return check`,
    projectId,
    assetId: lineItem.assetId || undefined,
  });

  return serialize(result);
}

// ─── Composite: Check + Pack (prep flow) ────────────────────────────────────

export async function completeCheckAndPack(data: CompleteCheckAndPackValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndPackSchema.parse(data);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Verify line item (needed to resolve assetId)
    const lineItem = await tx.projectLineItem.findFirst({
      where: {
        id: parsed.lineItemId,
        projectId: parsed.projectId,
        organizationId,
      },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Resolve assetId: prefer parsed value, fall back to line item's asset
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "PREP",
      parsed.checks
    );

    // 3. Fetch project location
    const project = await tx.project.findUnique({
      where: { id: parsed.projectId, organizationId },
      select: { locationId: true },
    });
    const projectLocationId = project?.locationId || null;

    // 4. Perform checkout (replicates checkOutItems internal logic)
    const isBulk =
      !!lineItem.bulkAssetId ||
      (!lineItem.assetId && lineItem.quantity > 1);

    if (isBulk) {
      const baseCheckedOut =
        lineItem.status === "RETURNED" ? 0 : lineItem.checkedOutQuantity;
      const newCheckedOutQty = baseCheckedOut + 1;
      const fullyCheckedOut = newCheckedOutQty >= lineItem.quantity;

      await tx.projectLineItem.update({
        where: { id: parsed.lineItemId },
        data: {
          checkedOutQuantity: newCheckedOutQty,
          returnedQuantity:
            lineItem.status === "RETURNED" ? 0 : lineItem.returnedQuantity,
          status: fullyCheckedOut
            ? "CHECKED_OUT"
            : lineItem.status === "QUOTED" || lineItem.status === "RETURNED"
              ? "CONFIRMED"
              : lineItem.status,
          checkedOutAt: fullyCheckedOut ? new Date() : lineItem.checkedOutAt,
          ...(fullyCheckedOut
            ? { checkedOutBy: { connect: { id: userId } } }
            : {}),
          prepStatus: "PACKED",
        },
      });
    } else {
      // Serialized asset
      const assetId = parsed.assetId || lineItem.assetId;

      if (assetId) {
        const assetRecord = await tx.asset.findUnique({
          where: { id: assetId },
          select: { status: true, assetTag: true },
        });
        if (
          assetRecord &&
          assetRecord.status === "CHECKED_OUT" &&
          lineItem.status !== "CHECKED_OUT"
        ) {
          throw new Error(
            `Asset ${assetRecord.assetTag} is already deployed`
          );
        }
      }

      await tx.projectLineItem.update({
        where: { id: parsed.lineItemId },
        data: {
          status: "CHECKED_OUT",
          checkedOutQuantity: 1,
          returnedQuantity: 0,
          returnCondition: null,
          returnNotes: null,
          returnedAt: null,
          checkedOutAt: new Date(),
          checkedOutBy: { connect: { id: userId } },
          ...(parsed.assetId
            ? { asset: { connect: { id: parsed.assetId } } }
            : {}),
          prepStatus: "PACKED",
        },
      });

      if (assetId) {
        await tx.asset.update({
          where: { id: assetId },
          data: {
            status: "CHECKED_OUT",
            ...(projectLocationId && { locationId: projectLocationId }),
          },
        });
      }
    }

    // 5. Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: parsed.assetId || lineItem.assetId || null,
        bulkAssetId: lineItem.bulkAssetId || null,
        projectId: parsed.projectId,
        action: "CHECK_OUT",
        scannedById: userId,
        notes: "Checked + packed",
      },
    });

    const updatedItem = await tx.projectLineItem.findUnique({
      where: { id: parsed.lineItemId },
      include: { model: true, asset: true, bulkAsset: true },
    });

    return { updatedItem, resolvedAssetId };
  });

  // Post-commit: predictive maintenance check
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error); // Don't fail the main operation
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_OUT",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Completed check and packed item`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  return serialize(result.updatedItem);
}

// ─── Composite: Check + Flag (prep flow — faulty/TT overdue) ───────────────

export async function completeCheckAndFlag(data: CompleteCheckAndFlagValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_out"
  );
  const parsed = completeCheckAndFlagSchema.parse(data);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Resolve assetId from line item if not provided
    const lineItem = await tx.projectLineItem.findFirst({
      where: { id: parsed.lineItemId, projectId: parsed.projectId, organizationId },
    });
    if (!lineItem) throw new Error("Line item not found in project");
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "PREP",
      parsed.checks
    );

    // 3. Update line item to flagged status
    const updatedItem = await tx.projectLineItem.update({
      where: { id: parsed.lineItemId },
      data: {
        prepStatus: parsed.flagType,
      },
      include: { model: true, asset: true, bulkAsset: true },
    });

    return { updatedItem, resolvedAssetId };
  });

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "UPDATE",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Flagged item as ${parsed.flagType === "FLAGGED_FAULTY" ? "faulty" : "T&T overdue"}`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  return serialize(result.updatedItem);
}

// ─── Composite: Check + Store (return flow) ─────────────────────────────────

export async function completeCheckAndStore(
  data: CompleteCheckAndStoreValues
) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "check_in"
  );
  const parsed = completeCheckAndStoreSchema.parse(data);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Verify line item (needed to resolve assetId)
    const lineItem = await tx.projectLineItem.findFirst({
      where: {
        id: parsed.lineItemId,
        projectId: parsed.projectId,
        organizationId,
      },
    });

    if (!lineItem) {
      throw new Error("Line item not found in project");
    }

    // Resolve assetId: prefer parsed value, fall back to line item's asset
    const resolvedAssetId = parsed.assetId || lineItem.assetId || "";

    // 2. Save check records
    await saveCheckRecords(
      tx,
      organizationId,
      userId,
      resolvedAssetId,
      parsed.lineItemId,
      parsed.bulkAssetId || lineItem.bulkAssetId,
      "RETURN",
      parsed.checks
    );

    // 3. Map condition to return status
    let returnStatus: "STORED" | "DAMAGED" | "LOST";
    let assetStatus: "AVAILABLE" | "IN_MAINTENANCE" | "LOST";

    switch (parsed.condition) {
      case "DAMAGED":
        returnStatus = "DAMAGED";
        assetStatus = "IN_MAINTENANCE";
        break;
      case "MISSING":
        returnStatus = "LOST";
        assetStatus = "LOST";
        break;
      case "GOOD":
      default:
        returnStatus = "STORED";
        assetStatus = "AVAILABLE";
        break;
    }

    // 4. Determine return location
    let locationId = parsed.locationId || null;
    if (!locationId) {
      const defaultLocation = await tx.location.findFirst({
        where: { organizationId, isDefault: true },
        select: { id: true },
      });
      locationId = defaultLocation?.id || null;
    }

    // 5. Perform checkin (replicates checkInItems internal logic)
    const isBulk =
      !!lineItem.bulkAssetId ||
      (!lineItem.assetId && lineItem.quantity > 1);

    if (isBulk) {
      const newReturnedQty = lineItem.returnedQuantity + 1;
      const fullyReturned = newReturnedQty >= lineItem.checkedOutQuantity;

      await tx.projectLineItem.update({
        where: { id: parsed.lineItemId },
        data: {
          returnedQuantity: newReturnedQty,
          status: fullyReturned ? "RETURNED" : "CHECKED_OUT",
          returnedAt: fullyReturned ? new Date() : lineItem.returnedAt,
          ...(fullyReturned
            ? { returnedBy: { connect: { id: userId } } }
            : {}),
          returnCondition: fullyReturned
            ? parsed.condition
            : lineItem.returnCondition,
          returnNotes: parsed.notes || lineItem.returnNotes,
          returnStatus,
        },
      });
    } else {
      await tx.projectLineItem.update({
        where: { id: parsed.lineItemId },
        data: {
          status: "RETURNED",
          returnedQuantity: 1,
          returnedAt: new Date(),
          returnedBy: { connect: { id: userId } },
          returnCondition: parsed.condition,
          returnNotes: parsed.notes || null,
          asset: lineItem.assetId ? { disconnect: true } : undefined,
          returnStatus,
        },
      });

      if (lineItem.assetId) {
        await tx.asset.update({
          where: { id: lineItem.assetId },
          data: {
            status: assetStatus,
            locationId,
          },
        });
      }
    }

    // 6. Create scan log
    await tx.assetScanLog.create({
      data: {
        organizationId,
        assetId: lineItem.assetId || null,
        bulkAssetId: lineItem.bulkAssetId || null,
        projectId: parsed.projectId,
        action: "CHECK_IN",
        scannedById: userId,
        notes: parsed.notes || `Checked + ${returnStatus.toLowerCase()}`,
      },
    });

    const updatedItem = await tx.projectLineItem.findUnique({
      where: { id: parsed.lineItemId },
      include: { model: true, asset: true, bulkAsset: true },
    });

    return { updatedItem, resolvedAssetId };
  });

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      result.resolvedAssetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CHECK_IN",
    entityType: "asset",
    entityId: result.resolvedAssetId || parsed.lineItemId,
    entityName: `Line item ${parsed.lineItemId}`,
    summary: `Completed check and stored item (condition: ${parsed.condition})`,
    projectId: parsed.projectId,
    assetId: result.resolvedAssetId || undefined,
  });

  return serialize(result.updatedItem);
}

// ─── Ad-Hoc Check ───────────────────────────────────────────────────────────

export async function saveAdHocCheck(data: SubmitChecksFormValues) {
  const { organizationId, userId, userName } = await requirePermission(
    "warehouse",
    "scan"
  );
  const parsed = submitChecksSchema.parse(data);

  if (parsed.context !== "AD_HOC") {
    throw new Error("This function is for ad-hoc checks only");
  }

  const records = await prisma.$transaction(async (tx) => {
    return saveCheckRecords(
      tx,
      organizationId,
      userId,
      parsed.assetId,
      null,
      parsed.bulkAssetId,
      "AD_HOC",
      parsed.checks
    );
  });

  // Post-commit: predictive maintenance
  const failedChecks = parsed.checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length > 0) {
    await checkPredictiveMaintenance(
      organizationId,
      userId,
      userName,
      parsed.assetId,
      failedChecks.map((c) => c.checkItemId)
    ).catch(console.error);
  }

  await logActivity({
    organizationId,
    userId,
    userName,
    action: "CREATE",
    entityType: "checkRecord",
    entityId: records[0]?.id || parsed.assetId,
    entityName: `Ad-hoc check on asset`,
    summary: `Performed ad-hoc check (${parsed.checks.length} items)`,
    assetId: parsed.assetId,
  });

  return serialize(records);
}

// ─── Asset Lookup for Ad-Hoc Checks ─────────────────────────────────────────

export async function lookupAssetForAdHocCheck(assetTag: string) {
  const { organizationId } = await getOrgContext();

  const asset = await prisma.asset.findUnique({
    where: { organizationId_assetTag: { organizationId, assetTag } },
    include: {
      model: {
        select: {
          id: true,
          name: true,
          _count: { select: { modelCheckItems: true } },
        },
      },
    },
  });

  if (!asset) {
    return serialize({ found: false as const, asset: null });
  }

  return serialize({
    found: true as const,
    asset: {
      id: asset.id,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber,
      modelId: asset.model.id,
      modelName: asset.model.name,
      checkItemCount: asset.model._count.modelCheckItems,
    },
  });
}

// ─── Check History & Analytics ──────────────────────────────────────────────

export async function getCheckHistory(assetId: string, context?: string) {
  const { organizationId } = await getOrgContext();

  return serialize(
    await prisma.checkRecord.findMany({
      where: {
        organizationId,
        assetId,
        ...(context && { context: context as "PREP" | "RETURN" | "AD_HOC" }),
      },
      include: {
        checkItem: { select: { label: true, type: true, category: true } },
        performedBy: { select: { name: true } },
        lineItem: {
          select: {
            project: { select: { id: true, name: true, projectNumber: true } },
          },
        },
      },
      orderBy: { performedAt: "desc" },
    })
  );
}

export async function getModelFailureAnalytics(modelId: string) {
  const { organizationId } = await getOrgContext();

  // Get all check items assigned to this model
  const modelCheckItems = await prisma.modelCheckItem.findMany({
    where: { modelId, organizationId },
    include: { checkItem: { select: { id: true, label: true, type: true } } },
    orderBy: { sortOrder: "asc" },
  });

  // Get all assets of this model
  const assets = await prisma.asset.findMany({
    where: { modelId, organizationId },
    select: { id: true },
  });
  const assetIds = assets.map((a) => a.id);

  if (assetIds.length === 0 || modelCheckItems.length === 0) {
    return serialize([]);
  }

  // Get aggregate counts per check item
  const analytics = await Promise.all(
    modelCheckItems.map(async (mci) => {
      const [totalCount, failCount] = await Promise.all([
        prisma.checkRecord.count({
          where: {
            organizationId,
            checkItemId: mci.checkItemId,
            assetId: { in: assetIds },
            result: { in: ["PASS", "FAIL"] },
          },
        }),
        prisma.checkRecord.count({
          where: {
            organizationId,
            checkItemId: mci.checkItemId,
            assetId: { in: assetIds },
            result: "FAIL",
          },
        }),
      ]);

      return {
        checkItemId: mci.checkItemId,
        label: mci.checkItem.label,
        type: mci.checkItem.type,
        totalChecks: totalCount,
        failCount,
        failRate: totalCount > 0 ? failCount / totalCount : 0,
      };
    })
  );

  return serialize(analytics);
}

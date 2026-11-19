"use client";

import { useConvex } from "convex/react";
import { toast } from "sonner";
import { api as convexApi } from "../../../../convex/_generated/api";
import { ItemCheckForm } from "@/components/warehouse/item-check-form";
import type { CheckQueueFlow } from "@/components/warehouse/job/use-check-queue";
import { useCheckRecordWrites } from "@/hooks/use-check-record-writes";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { showError } from "@/lib/show-error";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";
import { containerArgs, type ContainerChoice } from "@/lib/warehouse-container-choice";
import { pullItem, prepItemDirect, unpackItem } from "@/server/check-records";

/** The check form sheet + its submit / pass-all handlers (moved out of the page unchanged). */
export function CheckFlowSheet({
  flow, projectId, orgId, selectedContainer, activeContainerId, invalidate,
}: {
  flow: CheckQueueFlow;
  projectId: string;
  orgId: string | undefined;
  selectedContainer: string;
  activeContainerId: ContainerChoice;
  invalidate: () => void;
}) {
  const wConvex = useConvex();
  const checkRecordWrites = useCheckRecordWrites();
  const warehouseWrites = useWarehouseWrites();
  const {
    checkFormData, checkFormOpen, checkFormSubmitting, checkQueue, checkQueueIndex,
    setCheckFormOpen, setCheckFormData, setCheckFormSubmitting, setCheckQueue, setCheckQueueIndex,
    advanceCheckQueue, finishCheckQueue,
  } = flow;
  return (
    <>
    {checkFormData && (
      <ItemCheckForm
        open={checkFormOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCheckFormOpen(false);
            setCheckFormData(null);
            setCheckQueue([]);
            setCheckQueueIndex(0);
          }
        }}
        modelId={checkFormData.modelId}
        kitId={checkFormData.kitId}
        assetTag={checkFormData.assetTag}
        assetName={checkFormData.assetName}
        context={checkFormData.context}
        isSubmitting={checkFormSubmitting}
        queuePosition={checkQueue.length > 1 ? checkQueueIndex + 1 : undefined}
        queueTotal={checkQueue.length > 1 ? checkQueue.length : undefined}
        onCancel={() => {
          setCheckFormOpen(false);
          setCheckFormData(null);
          setCheckQueue([]);
          setCheckQueueIndex(0);
        }}
        onPassAllRemaining={checkQueue.length > 1 ? async () => {
          // Auto-pass all remaining items in the queue (including current)
          setCheckFormSubmitting(true);
          try {
            const remaining = checkQueue.slice(checkQueueIndex);
            for (const item of remaining) {
              const isKitLevelItem = !!item.kitId;
              const isKitQueueChild = !!item.kitQueueKitId && !item.kitId;

              // Fetch check items (kit-level or model-level)
              const checkItems = isKitLevelItem
                ? await wConvex.query(convexApi.kitCheckItems.assignmentsForKit, { orgId: orgId as string, kitId: item.kitId! })
                : await wConvex.query(convexApi.modelCheckItems.assignmentsForModel, { orgId: orgId as string, modelId: item.modelId! });
              const checks: CheckRecordFormValues[] = (checkItems as Array<{ checkItem: { id: string; type: string } }>).map((mci) => ({
                checkItemId: mci.checkItem.id,
                result: mci.checkItem.type === "NOTES" ? "NOTES_ONLY" as const : "PASS" as const,
                photos: [],
              }));

              // Empty-checks guard (mirrors the PR #120 form guard for the
              // "pass all remaining" path). The completeCheck*/saveKit* server
              // actions enforce checks.min(1) and 500 on an empty array. The
              // cached project's _count.modelCheckItems gate that queued this
              // item can diverge from the live getModelCheckItems fetch above
              // (e.g. an admin removed the model's check items after the
              // warehouse page cached the project), leaving `checks` empty.
              // Route those items through their no-check equivalent instead of
              // crashing — items with no checks are meant to flow through
              // prepItemDirect / checkInItems, not the check actions.
              if (checks.length === 0) {
                if (isKitLevelItem || isKitQueueChild) {
                  // Kit deploy/return is finalized in finishCheckQueue — there
                  // is nothing to record here, so just skip the save.
                  continue;
                }
                if (item.context === "PREP") {
                  await prepItemDirect(
                    projectId,
                    item.lineItemId,
                    item.assetId || undefined,
                    item.assetId ? undefined : 1,
                    selectedContainer || null,
                    undefined,
                    containerArgs(activeContainerId).containerId,
                  );
                } else if (item.fromDeprep) {
                  // completeCheckAndDeprep tolerates an empty checks[] (it
                  // does not re-parse against a .min(1) schema).
                  await checkRecordWrites.completeCheckAndDeprep({
                    projectId,
                    lineItemId: item.lineItemId,
                    assetId: item.assetId,
                    bulkAssetId: item.bulkAssetId,
                    checks,
                  });
                } else {
                  // RETURN store with no checks — return to inventory via the
                  // no-check check-in path (same as finishCheckQueue's direct
                  // items) rather than completeCheckAndStore (min(1)).
                  await warehouseWrites.checkInItems(projectId, [
                    {
                      lineItemId: item.lineItemId,
                      assetId: item.assetId || undefined,
                      returnCondition: "GOOD",
                      quantity: item.assetId ? undefined : 1,
                    },
                  ]);
                }
                continue;
              }

              if (isKitLevelItem) {
                // Kit-level: save records only, deploy happens in finishCheckQueue
                await checkRecordWrites.saveKitLevelChecks(projectId, item.kitId!, item.lineItemId, item.context, checks);
              } else if (isKitQueueChild) {
                // PER_ITEM child: save records only, deploy happens in finishCheckQueue
                await checkRecordWrites.saveChildItemChecks(projectId, item.lineItemId, item.assetId || undefined, item.bulkAssetId, item.context, checks);
              } else if (item.context === "PREP") {
                await pullItem(projectId, item.lineItemId).catch(() => {});
                await checkRecordWrites.completeCheckAndPack({
                  projectId,
                  lineItemId: item.lineItemId,
                  assetId: item.assetId,
                  bulkAssetId: item.bulkAssetId,
                  prepContainer: selectedContainer || null,
                  ...containerArgs(activeContainerId),
                  checks,
                  includeAccessoryIds: item.includeAccessoryIds,
                });
              } else if (item.fromDeprep) {
                await checkRecordWrites.completeCheckAndDeprep({
                  projectId,
                  lineItemId: item.lineItemId,
                  assetId: item.assetId,
                  bulkAssetId: item.bulkAssetId,
                  checks,
                });
              } else {
                await unpackItem(projectId, item.lineItemId).catch(() => {});
                await checkRecordWrites.completeCheckAndStore({
                  projectId,
                  lineItemId: item.lineItemId,
                  assetId: item.assetId,
                  bulkAssetId: item.bulkAssetId,
                  checks,
                  condition: "GOOD",
                });
              }
            }
            toast.success(`Passed all checks for ${remaining.length} item${remaining.length !== 1 ? "s" : ""}`);
            finishCheckQueue();
          } catch (e) {
            showError(e, { fallbackTitle: "Pass all failed" });
          } finally {
            setCheckFormSubmitting(false);
          }
        } : undefined}
        onSubmit={async (checks: CheckRecordFormValues[], returnInfo?: { condition: "GOOD" | "DAMAGED" | "MISSING"; notes?: string }) => {
          if (!checkFormData) return;
          setCheckFormSubmitting(true);
          try {
            const hasFails = checks.some((c) => c.result === "FAIL");
            const isKitLevelItem = !!checkFormData.kitId;
            const isKitQueueChild = !!checkFormData.kitQueueKitId && !checkFormData.kitId;

            if (isKitLevelItem) {
              // Kit-level check: save records, then deploy/return in finishCheckQueue
              await checkRecordWrites.saveKitLevelChecks(projectId, checkFormData.kitId!, checkFormData.lineItemId, checkFormData.context, checks);
              toast.success(hasFails ? "Kit check completed with issues" : "Kit check passed");
            } else if (isKitQueueChild) {
              // PER_ITEM child: save records only, deploy/return happens in finishCheckQueue
              await checkRecordWrites.saveChildItemChecks(
                projectId,
                checkFormData.lineItemId,
                checkFormData.assetId || undefined,
                checkFormData.bulkAssetId,
                checkFormData.context,
                checks
              );
              toast.success(hasFails ? "Item check completed with issues" : "Item check passed");
            } else if (checkFormData.context === "PREP") {
              if (hasFails) {
                await checkRecordWrites.completeCheckAndFlag({
                  projectId,
                  lineItemId: checkFormData.lineItemId,
                  assetId: checkFormData.assetId,
                  bulkAssetId: checkFormData.bulkAssetId,
                  checks,
                  flagType: "FLAGGED_FAULTY",
                });
                toast.success("Item flagged as faulty");
              } else {
                await checkRecordWrites.completeCheckAndPack({
                  projectId,
                  lineItemId: checkFormData.lineItemId,
                  assetId: checkFormData.assetId,
                  bulkAssetId: checkFormData.bulkAssetId,
                  prepContainer: selectedContainer || null,
                  ...containerArgs(activeContainerId),
                  checks,
                  includeAccessoryIds: checkFormData.includeAccessoryIds,
                });
                toast.success("Item checked and packed");
              }
            } else if (checkFormData.fromDeprep) {
              // RETURN deprep — item is already returned, just record checks and reset prepStatus
              await checkRecordWrites.completeCheckAndDeprep({
                projectId,
                lineItemId: checkFormData.lineItemId,
                assetId: checkFormData.assetId,
                bulkAssetId: checkFormData.bulkAssetId,
                checks,
              });
              toast.success("Item checked and returned to inventory");
            } else {
              // RETURN — condition comes from the check form
              const condition = returnInfo?.condition || "GOOD";
              await checkRecordWrites.completeCheckAndStore({
                projectId,
                lineItemId: checkFormData.lineItemId,
                assetId: checkFormData.assetId,
                bulkAssetId: checkFormData.bulkAssetId,
                checks,
                condition,
                notes: returnInfo?.notes || undefined,
              });
              const condLabel = condition === "GOOD" ? "stored" : condition === "DAMAGED" ? "flagged damaged" : "flagged missing";
              toast.success(`Item checked and ${condLabel}`);
            }

            // Advance queue or close
            if (checkQueue.length > 1) {
              advanceCheckQueue();
              invalidate();
            } else {
              // Single item or last in queue — finish
              finishCheckQueue();
            }
          } catch (e) {
            showError(e, { fallbackTitle: "Check submission failed" });
          } finally {
            setCheckFormSubmitting(false);
          }
        }}
      />
    )}
    </>
  );
}

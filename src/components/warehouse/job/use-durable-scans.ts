"use client";

import { useConvex, useConvexAuth } from "convex/react";
import { ReviewScanError, type SavedScan } from "@/lib/scan-intake";
import { useDurableScanIntake } from "@/hooks/use-durable-scan-intake";
import { lookupAssetForScan } from "@/server/warehouse";
import { collectAllVerifiableIds, type LineItem } from "@/components/warehouse/warehouse-types";
import type { useScanFeedback } from "@/hooks/use-scan-feedback";
import { api as convexApi } from "../../../../convex/_generated/api";
import type { JobGates } from "./use-job-gates";
import type { CheckOutItem, ReturnConditionValue } from "./job-types";

type Feedback = ReturnType<typeof useScanFeedback>;

const childrenOf = (li: LineItem) => (li.childLineItems || []) as LineItem[];

/** A kit-member scan on Return only verifies locally; every other kit-member / accessory scan is refused. */
function refuseKitMember(
  result: { assetId: string | null; kitId: string | null; assetName: string }, operation: SavedScan["operation"],
  lineItems: LineItem[], gates: JobGates,
): never {
  const kitLine = lineItems.find((l) => l.kitId === result.kitId && !l.isKitChild);
  if (operation === "return" && kitLine && result.assetId) {
    const kids = childrenOf(kitLine);
    const child = kids.find((c) => c.assetId === result.assetId) || kids.flatMap(childrenOf).find((c) => c.assetId === result.assetId);
    if (child) gates.setVerifiedKitItems((prev) => new Set(prev).add(child.id));
    throw new Error("Verified locally — not returned. Scan the kit barcode to return it.");
  }
  throw new Error("Kit member: scan the kit barcode. Saved for review.");
}

/**
 * The Prepped / Out dock writes through here: every scan is saved durably BEFORE the lookup, resolved to
 * one effect, optionally reviewed (accessory gate, kit confirm), then committed with the operation id so
 * a lost acknowledgement replays the same payload.
 */
export function useDurableScans(deps: {
  orgId: string | undefined; userId: string | undefined; projectId: string; versionId: string;
  lineItems: LineItem[]; gates: JobGates; scanFeedback: Feedback;
  openAccessoryGateIfNeeded: (items: CheckOutItem[], durableOperationId?: string) => boolean;
  returnCheck: { condition: ReturnConditionValue; notes: string };
}) {
  const { orgId, userId, projectId, versionId, lineItems, gates, scanFeedback, openAccessoryGateIfNeeded, returnCheck } = deps;
  const wConvex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { verifiedKitItems, setKitConfirm } = gates;

  /** Resolve a raw scan to the effect the commit will carry (throws a reviewable error when it cannot). */
  const resolveEffect = async (entry: SavedScan, assertCurrent: () => void): Promise<NonNullable<SavedScan["effect"]>> => {
    const result = await lookupAssetForScan(entry.projectId, entry.raw.trim(), entry.operation === "deploy" ? "checkout" : "checkin");
    assertCurrent();
    if (!result.found) throw new Error("Asset not found. Saved for review.");
    if (result.type === "kit_member") refuseKitMember(result as { assetId: string | null; kitId: string | null; assetName: string }, entry.operation, lineItems, gates);
    if (result.type === "asset_child") throw new Error("Accessory: scan its parent barcode. Saved for review.");
    if (!result.lineItemId || result.reason) throw new Error(result.reason || "Item is not actionable on this job");
    const matched = lineItems.find((l) => l.id === result.lineItemId);
    if (!matched) throw new Error("Job data unavailable. Reconnect and review this saved scan.");
    if (entry.operation === "deploy" && (matched.prepStatus !== "PACKED" || matched.status === "CHECKED_OUT")) throw new Error("Item is not prepped or is already deployed");
    if (result.type !== "kit") return { lineItemId: result.lineItemId, assetId: result.assetId || undefined };
    const ids = collectAllVerifiableIds(childrenOf(matched), "return");
    const allVerified = entry.operation === "return" && ids.every((id) => verifiedKitItems.has(id));
    return { kitId: (result as { kitId: string }).kitId, lineItemId: matched.id, ...(allVerified ? { kitDecision: "all" as const } : {}) };
  };

  /** A Return of a kit with unverified contents opens the confirm instead of committing. */
  const reviewKitReturn = (entry: SavedScan) => {
    const matched = lineItems.find((l) => l.id === entry.effect!.lineItemId);
    if (!matched) throw new Error("Kit version data unavailable. Return to its captured job version.");
    const ids = collectAllVerifiableIds(childrenOf(matched), "return");
    const verifiedIds = ids.filter((id) => verifiedKitItems.has(id));
    setKitConfirm({ action: "return", kitName: matched.kit?.name || "Kit", kitId: entry.effect!.kitId!, parentLineItemId: matched.id, verifiedCount: verifiedIds.length, totalCount: ids.length, verifiedIds, durableOperationId: entry.id });
    throw new ReviewScanError("Verify kit contents or select Return All. Captured condition and notes are saved.");
  };

  const durable = useDurableScanIntake(
    isAuthenticated && orgId && userId ? { orgId, userId, projectId, expectedVersionId: versionId } : null,
    async (operation) => {
      if (!orgId || !userId) throw new Error("Sign in again before replaying scans");
      return wConvex.query(convexApi.scanIntake.verifyContext, { orgId, projectId, expectedUserId: userId, operation });
    },
    async (entry, assertCurrent, save) => {
      if (!entry.expectedVersionId) throw new Error("Saved scan has no job version. Review before recapturing.");
      if (!entry.effect) {
        // The raw scan, condition and notes are durable BEFORE this lookup. Persist the resolved intent before sending,
        // so acknowledgement-loss replay uses the SAME operation and payload even if a later lookup would differ.
        entry.effect = await resolveEffect(entry, assertCurrent);
        save(entry);
      }
      const effect = entry.effect;
      if (entry.operation === "deploy" && !effect.kitId && !effect.accessoryDecision &&
          openAccessoryGateIfNeeded([{ lineItemId: effect.lineItemId!, assetId: effect.assetId }], entry.id)) {
        throw new ReviewScanError("Review accessories before deploying. Captured scan is saved.");
      }
      if (entry.operation === "return" && effect.kitId && !effect.kitDecision) reviewKitReturn(entry);
      assertCurrent();
      const ack = await wConvex.mutation(convexApi.scanIntake.commit, {
        orgId: entry.orgId, projectId: entry.projectId, expectedUserId: entry.userId, expectedVersionId: entry.expectedVersionId,
        operationId: entry.id, operation: entry.operation, raw: entry.raw, condition: entry.condition, notes: entry.notes, effect: entry.effect,
      });
      if (!ack.confirmed) throw new Error("Server acknowledgement missing");
      try {
        assertCurrent();
        scanFeedback.play("success", { label: entry.raw, outcome: entry.operation === "deploy" ? "Deployed — confirmed" : "Returned — confirmed" });
      } catch { /* the server acknowledgement stays true even if the displayed scope or feedback changes */ }
    },
  );

  const captureDeployScan = (raw: string) => { durable.capture("deploy", raw, "GOOD", ""); };
  const captureReturnScan = (raw: string) => { durable.capture("return", raw, returnCheck.condition, returnCheck.notes); };
  return { durable, captureDeployScan, captureReturnScan };
}

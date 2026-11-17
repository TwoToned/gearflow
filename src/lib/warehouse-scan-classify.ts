/**
 * Pure classification of ONE scan on the warehouse job page (spec §5.7, §9.2).
 * Folds the three legacy pipelines (prep / deploy / return) into a single
 * decision table. Wording is copied from the legacy `scanMutation` handlers so
 * a changed message is a deliberate diff (see the test).
 */
export type ScanStage = "pick" | "prepped" | "out" | "returned";
export type ScanTone = "success" | "warning" | "error" | "neutral";

/** The subset of `lookupAssetForScan`'s result the classifier reads. */
export interface ScanLookup {
  found: boolean;
  type?: "kit" | "kit_member" | "asset_child" | "serialized" | "bulk" | null;
  lineItemId?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  reason?: string | null;
  kitId?: string | null;
  kitAssetTag?: string | null;
  parentAssetTag?: string | null;
  modelId?: string | null;
  bulkAssetId?: string | null;
  isBulk?: boolean;
  detail?: string;
  assetStatus?: string;
  ttStatus?: string;
  ttNextDueDate?: string | null;
}

export type ScanPlan =
  | { kind: "setCase"; containerId: string; label: string }
  | { kind: "verifyKitMember"; kitId: string; assetId: string; name: string }
  | { kind: "kit"; kitId: string; lineItemId: string; name: string }
  | { kind: "act"; lineItemId: string; assetId: string | null; name: string }
  | { kind: "offerAdd"; name: string; modelId: string; assetId: string | null; bulkAssetId: string | null; isBulk: boolean }
  | { kind: "refuse"; tone: ScanTone; text: string }
  | { kind: "duplicate"; name: string };

export interface ScanContext {
  /** Case tags on this job: tag → container. */
  containersByTag: ReadonlyMap<string, { id: string; label: string }>;
  /** `lineItemId:assetId` pairs already queued in the "Bulk after" batch. */
  batchKeys?: ReadonlySet<string>;
  /** Whether the kit with this id has a line on this job (kit_member). */
  kitOnJob?: (kitId: string) => boolean;
}

const refuse = (tone: ScanTone, text: string): ScanPlan => ({ kind: "refuse", tone, text });
const NOT_FOUND = "Asset not found";

function kitPlan(r: ScanLookup): ScanPlan {
  const name = r.assetName ?? "Kit";
  if (r.lineItemId && !r.reason) return { kind: "kit", kitId: r.kitId ?? "", lineItemId: r.lineItemId, name };
  const messages: Record<string, string> = {
    not_on_project: "Kit not assigned to this job",
    already_checked_out: "Kit already deployed",
  };
  return refuse("error", messages[r.reason ?? ""] ?? "Cannot prep this kit");
}

function reasonText(r: ScanLookup, stage: ScanStage): string {
  const status = (r.assetStatus ?? "").replace("_", " ").toLowerCase();
  const due = r.ttNextDueDate ? new Date(r.ttNextDueDate).toLocaleDateString() : "";
  const messages: Record<string, string> = {
    already_checked_out: "Already deployed on this job",
    asset_checked_out_elsewhere: `Already deployed${r.detail ?? ""}`,
    not_on_project: "Asset not assigned to this job",
    not_checked_out: "Asset is not deployed on this job",
    already_returned: "All units already returned",
    asset_unavailable: `Asset is ${status} and cannot be deployed`,
    tt_blocked: `Test & Tag ${(r.ttStatus ?? "").toLowerCase()}${due ? ` — next test due ${due}` : ""}. Cannot deploy until tested.`,
  };
  return messages[r.reason ?? ""] ?? (stage === "out" ? "Cannot return this asset" : "Cannot deploy this asset");
}

function memberPlan(r: ScanLookup, ctx: ScanContext): ScanPlan {
  if (r.kitId && r.assetId && ctx.kitOnJob?.(r.kitId)) {
    return { kind: "verifyKitMember", kitId: r.kitId, assetId: r.assetId, name: r.assetName ?? "" };
  }
  const kit = r.kitAssetTag ? ` (${r.kitAssetTag})` : "";
  return refuse("error", `This asset is in a kit${kit} not on this job.`);
}

function accessoryPlan(r: ScanLookup): ScanPlan {
  const of = r.parentAssetTag ? ` of ${r.parentAssetTag}` : "";
  return refuse("warning", `${r.assetName ?? "Item"} is an accessory${of} — scan the parent; accessories move with it.`);
}

function linePlan(r: ScanLookup, lineItemId: string, stage: ScanStage, ctx: ScanContext): ScanPlan {
  const name = r.assetName ?? "Asset";
  const queued = stage === "pick" && r.assetId && ctx.batchKeys?.has(`${lineItemId}:${r.assetId}`);
  return queued ? { kind: "duplicate", name } : { kind: "act", lineItemId, assetId: r.assetId ?? null, name };
}

function unactionablePlan(r: ScanLookup, stage: ScanStage): ScanPlan {
  if (r.reason === "not_on_project" && r.modelId) {
    return {
      kind: "offerAdd", name: r.assetName ?? "Unknown asset", modelId: r.modelId,
      assetId: r.assetId ?? null, bulkAssetId: r.bulkAssetId ?? null, isBulk: !!r.isBulk,
    };
  }
  // "already_returned" is resolved-but-needs-attention (warning); every other reason blocks.
  return refuse(r.reason === "already_returned" ? "warning" : "error", reasonText(r, stage));
}

export function classifyScan(raw: string, result: ScanLookup | null, stage: ScanStage, ctx: ScanContext): ScanPlan {
  const container = ctx.containersByTag.get(raw.trim());
  if (container) return { kind: "setCase", containerId: container.id, label: container.label };
  if (!result || !result.found) return refuse("warning", NOT_FOUND);
  if (result.type === "kit") return kitPlan(result);
  if (result.type === "kit_member") return memberPlan(result, ctx);
  if (result.type === "asset_child") return accessoryPlan(result);
  if (result.lineItemId) return linePlan(result, result.lineItemId, stage, ctx);
  return unactionablePlan(result, stage);
}

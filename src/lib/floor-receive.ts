/**
 * The floor's `Receive` reading, decided ONCE (spec §9c.4): what a scanned tag
 * means on the way back in. `returnsLookup.resolve` answers the question
 * server-side (org-checked); this turns its answer into one of three plans:
 * a notice for the strip (never blocks the dock), ONE write, or a `Which job?`
 * choice (the floor never auto-picks between jobs). Pure, so the dock hook and
 * the tests share it.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

export type ReceiveResolve = FunctionReturnType<typeof api.returnsLookup.resolve>;

interface JobRef {
  projectId: string;
  projectNumber: string;
  projectName: string;
}

export type ReceiveTarget =
  | (JobRef & { kind: "asset"; label: string; tag: string; assetId: string; lineItemId: string; unitId: string })
  | (JobRef & { kind: "kit"; label: string; tag: string; kitId: string })
  | (JobRef & { kind: "bulk"; label: string; tag: string; bulkAssetId: string; quantity: number });

export type ReceivePlan =
  | { type: "notice"; tone: "warning" | "error" | "neutral"; text: string }
  | { type: "write"; target: ReceiveTarget }
  | { type: "choose"; label: string; options: ReceiveTarget[] };

type Res<K extends ReceiveResolve["kind"]> = Extract<ReceiveResolve, { kind: K }>;

function noticeFor(value: string, res: Res<"not_found" | "guard_kit_member" | "guard_accessory_child" | "exception">): ReceivePlan {
  if (res.kind === "not_found") return { type: "notice", tone: "error", text: `${value} · not found` };
  if (res.kind === "guard_kit_member") {
    return { type: "notice", tone: "warning", text: `${res.assetTag} is in kit ${res.kitAssetTag ?? "(unknown)"} · scan the kit` };
  }
  if (res.kind === "guard_accessory_child") {
    return { type: "notice", tone: "warning", text: `${res.assetTag} returns with its parent ${res.parentAssetTag ?? ""}`.trim() };
  }
  const why = res.reason === "retired" ? "retired, not returnable" : "not out on any job";
  return { type: "notice", tone: "neutral", text: `${res.assetTag} · ${why}` };
}

const assetTarget = (r: Res<"asset" | "asset_multi">, d: Res<"asset_multi">["deployments"][number]): ReceiveTarget => ({
  kind: "asset", label: r.assetName, tag: r.assetTag, assetId: r.assetId,
  lineItemId: d.lineItemId, unitId: d.unitId, projectId: d.projectId, projectNumber: d.projectNumber, projectName: d.projectName,
});
const kitTarget = (r: Res<"kit" | "kit_multi">, d: JobRef): ReceiveTarget => ({
  kind: "kit", label: r.assetName, tag: r.assetTag, kitId: r.kitId, ...pickJob(d),
});
const bulkTarget = (r: Res<"bulk" | "bulk_multi">, d: JobRef & { outstanding: number }): ReceiveTarget => ({
  kind: "bulk", label: r.assetName, tag: r.assetTag, bulkAssetId: r.bulkAssetId, quantity: d.outstanding, ...pickJob(d),
});
const pickJob = (d: JobRef): JobRef => ({ projectId: d.projectId, projectNumber: d.projectNumber, projectName: d.projectName });

export function planReceive(value: string, res: ReceiveResolve): ReceivePlan {
  switch (res.kind) {
    case "asset":
      return { type: "write", target: assetTarget(res, res) };
    case "kit":
      return { type: "write", target: kitTarget(res, res) };
    case "bulk":
      return { type: "write", target: bulkTarget(res, res) };
    case "asset_multi":
      return { type: "choose", label: `${res.assetTag} ${res.assetName}`, options: res.deployments.map((d) => assetTarget(res, d)) };
    case "kit_multi":
      return { type: "choose", label: `${res.assetTag} ${res.assetName}`, options: res.deployments.map((d) => kitTarget(res, d)) };
    case "bulk_multi":
      return { type: "choose", label: `${res.assetTag} ${res.assetName}`, options: res.deployments.map((d) => bulkTarget(res, d)) };
    default:
      return noticeFor(value, res);
  }
}

/** The strip text for a return that landed: `SK-0012 Shure SM58 · back from #2341`. */
export function receivedText(t: ReceiveTarget, quantity?: number): string {
  const qty = t.kind === "bulk" ? ` ×${quantity ?? t.quantity}` : "";
  return `${t.tag} ${t.label}${qty} · back from #${t.projectNumber}`;
}

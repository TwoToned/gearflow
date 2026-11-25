"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteDialog } from "@/components/ui/delete-dialog";
import { CameraScannerDialog } from "@/components/scanner/camera-scanner-dialog";
import { ReportIssueDialog } from "@/components/warehouse/report-issue-dialog";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { useRetireAssets } from "@/hooks/use-retire-assets";
import { useLocations } from "@/hooks/use-locations";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { activeLine } from "@/lib/asset-whereabouts";
import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import { MoveDialog, PrintLabelDialog, RetireDialog, ScheduleServiceDialog } from "./asset-dialogs";

export type AssetDialog = "retire" | "force" | "move" | "service" | "label" | "report" | "scan" | null;

/** Runs one write; a failure is a toast, never an uncaught error. */
async function attempt(fn: () => Promise<unknown>, fallbackTitle: string) {
  try {
    await fn();
  } catch (e) {
    showError(e, { fallbackTitle });
  }
}

/**
 * Every dialog the asset page opens, with the write each one confirms and its Undo
 * (UX Phase 12, §9d.3). The page only says which is open; each write toasts, and the
 * reversible ones hand their ONE closure to `announceListWrite`.
 */
export function AssetDialogsHost({
  asset, dialog, setDialog, onScan,
}: {
  asset: NativeAssetDetail;
  dialog: AssetDialog;
  setDialog: (d: AssetDialog) => void;
  onScan: (value: string) => void;
}) {
  const router = useRouter();
  const { data: org } = useActiveOrganization();
  const writes = useAssetWrites();
  const maintenance = useMaintenanceWrites();
  const warehouse = useWarehouseWrites();
  const { retireMany } = useRetireAssets();
  const locations = useLocations(org?.id) ?? [];
  const mayDelete = useCanDo("asset", "delete");
  const { id, assetTag: tag } = asset;
  const out = activeLine(asset);
  const close = (d: Exclude<AssetDialog, null>) => (o: boolean) => setDialog(o ? d : null);

  return (
    <>
      <CameraScannerDialog open={dialog === "scan"} onOpenChange={close("scan")} onScan={onScan} title={`Scan a tag from ${tag}`} />
      <RetireDialog
        open={dialog === "retire"}
        onOpenChange={close("retire")}
        tag={tag}
        deployed={!!out}
        canDelete={mayDelete && asset.facts.canDelete}
        onRetire={async () => void (await retireMany([{ id, tag, kind: "serialized", status: asset.status }]))}
        onDelete={() => attempt(async () => { await writes.remove(id); toast.success(`Deleted ${tag}`); router.push("/assets/registry"); }, "Couldn't delete the asset")}
      />
      <DeleteDialog
        open={dialog === "force"}
        onOpenChange={close("force")}
        title={`Force return ${tag}?`}
        description="The line on its job is marked returned and the unit goes back to AVAILABLE at its home location. The return check is skipped and the skip is logged. Use this when scanning isn't possible."
        confirmLabel="Force return"
        onConfirm={() => { setDialog(null); void attempt(async () => { await warehouse.forceReturnAsset(id); toast.success(`${tag} force returned to available`); }, "Couldn't force return"); }}
        pending={false}
      />
      <MoveDialog
        open={dialog === "move"}
        onOpenChange={close("move")}
        tag={tag}
        currentLocationId={asset.locationId}
        locations={locations}
        onMove={(to) => attempt(async () => {
          const r = await writes.move(id, to);
          announceListWrite({
            title: r.undoable ? `Moved ${tag}` : `${tag} is already there`,
            undoneTitle: `Moved ${tag} back`,
            performUndo: r.undoable ? async () => void (await writes.undoUpdate(id, r.auditId)) : undefined,
          });
        }, "Couldn't move the asset")}
      />
      <ScheduleServiceDialog
        open={dialog === "service"}
        onOpenChange={close("service")}
        tag={tag}
        onSchedule={({ title, scheduledDate }) => attempt(async () => {
          const { id: recordId } = await maintenance.create({ assetIds: [id], type: "PREVENTATIVE", status: "SCHEDULED", title, scheduledDate });
          announceListWrite({ title: `Scheduled ${title} for ${tag}`, undoneTitle: "Service removed", performUndo: async () => void (await maintenance.undoCreate(recordId)) });
        }, "Couldn't schedule the service")}
      />
      <PrintLabelDialog open={dialog === "label"} onOpenChange={close("label")} tag={tag} name={asset.customName || asset.model?.name || tag} />
      <ReportIssueDialog
        open={dialog === "report"}
        onOpenChange={close("report")}
        targetLabel={tag}
        assetId={id}
        projectId={out?.projectId ?? undefined}
        lineItemId={out?.id}
      />
    </>
  );
}

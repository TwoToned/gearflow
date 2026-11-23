"use client";

import { useState } from "react";

import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";

/** What the dialog opens with: the asset, and the failure in words. */
export interface MaintenancePrefill {
  assetId: string;
  assetTag: string;
  reason: string;
}

/**
 * The Scan page's `Create maintenance job…` (spec §9i.2 card ⋯, the save caret's `Save and
 * create maintenance job` on a fail, and a failed Last scans row). One EXISTING mutation,
 * `maintenanceWrites.createNative` (a SCHEDULED repair linked to the asset), and its exact
 * reverse `deleteNative` as the Undo, through ONE `announceListWrite` closure. The Undo is
 * absent without `maintenance:delete` (the returns station's "Raise repair" precedent).
 */
export function useMaintenanceJob() {
  const writes = useMaintenanceWrites();
  const canCreate = useCanDo("maintenance", "create");
  const canDelete = useCanDo("maintenance", "delete");
  const [prefill, setPrefill] = useState<MaintenancePrefill | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async (p: MaintenancePrefill, form: { title: string; description: string }): Promise<boolean> => {
    setSaving(true);
    try {
      const { id } = await writes.create({
        assetId: p.assetId, type: "REPAIR", status: "SCHEDULED",
        title: form.title.trim(), description: form.description.trim() || undefined,
      });
      announceListWrite({
        title: `Maintenance job created for ${p.assetTag}`,
        undoneTitle: `Maintenance job for ${p.assetTag} removed`,
        performUndo: canDelete
          ? async () => {
              await writes.remove(id);
            }
          : undefined,
      });
      setPrefill(null);
      return true;
    } catch (e) {
      showError(e, { fallbackTitle: "Couldn't create the maintenance job" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { canCreate, prefill, open: setPrefill, close: () => setPrefill(null), create, saving };
}

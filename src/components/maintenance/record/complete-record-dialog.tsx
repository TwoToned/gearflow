"use client";

import * as React from "react";

import { CompleteDialog, type CompleteAsset } from "@/components/maintenance/record/complete-dialog";
import { useMaintenanceRecordWrites, type CompleteInput } from "@/components/maintenance/record/use-maintenance-record-writes";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { announceListWrite } from "@/lib/list-write-toast";
import { api } from "../../../../convex/_generated/api";

/** The record as `maintenanceRecords.recordDetail` returns it (the parts the Complete dialog reads). */
interface CompleteRecordSource {
  title: string;
  nextDueDate: string | null;
  cost?: number | null;
  assets: Array<{ assetId: string; asset: { assetTag: string; model: { name: string } } }>;
}

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

/**
 * The Complete dialog for ONE maintenance record, loading what it needs itself, so the record page and the list's
 * `Mark done…` row verb are the SAME verb (UX Phase 14, 14a-3b): `completeNative`, an exact Undo from the audit id of that
 * very call (none after a Retire), labour only when the read carried it. Renders nothing until the record has arrived.
 */
export function CompleteRecordDialog({ orgId, id, open, onOpenChange }: { orgId: string | undefined; id: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const now = useStableNow();
  const record = useAuthedQuery(api.maintenanceRecords.recordDetail, orgId && id && open ? { orgId, id } : "skip") as CompleteRecordSource | null | undefined;
  const writes = useMaintenanceRecordWrites(orgId, id ?? "");
  if (!record || !id) return null;

  const assets: CompleteAsset[] = record.assets.map((l) => ({ assetId: l.assetId, assetTag: l.asset.assetTag, modelName: l.asset.model.name }));
  const complete = async (input: CompleteInput) => {
    const r = await writes.complete(input);
    announceListWrite({ title: `Completed ${record.title}`, undoneTitle: "Completion undone", performUndo: r.undoable ? async () => void (await writes.undoLifecycle(r.auditId)) : undefined });
  };
  return (
    <CompleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={record.title}
      now={now}
      assets={assets}
      labourVisible={Object.hasOwn(record, "cost")}
      storedLabour={record.cost ?? null}
      storedNextDue={ms(record.nextDueDate)}
      onComplete={complete}
    />
  );
}

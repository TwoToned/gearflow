"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MaintenancePrefill } from "./use-maintenance-job";

/**
 * `Create maintenance job` (spec §9i.2): a scheduled repair on the scanned asset,
 * prefilled with what failed. Radix `Dialog` (no AlertDialog). The write and its Undo
 * live in `useMaintenanceJob`.
 */
export function CreateMaintenanceDialog({
  prefill,
  saving,
  onCancel,
  onCreate,
}: {
  prefill: MaintenancePrefill | null;
  saving: boolean;
  onCancel: () => void;
  onCreate: (form: { title: string; description: string }) => void;
}) {
  return (
    <Dialog open={!!prefill} onOpenChange={(o) => (o ? undefined : onCancel())}>
      <DialogContent>
        {prefill ? <Form key={`${prefill.assetId}|${prefill.reason}`} prefill={prefill} saving={saving} onCancel={onCancel} onCreate={onCreate} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  prefill,
  saving,
  onCancel,
  onCreate,
}: {
  prefill: MaintenancePrefill;
  saving: boolean;
  onCancel: () => void;
  onCreate: (form: { title: string; description: string }) => void;
}) {
  const [title, setTitle] = useState(`Repair — ${prefill.assetTag}`);
  const [description, setDescription] = useState(prefill.reason);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onCreate({ title, description });
      }}
    >
      <DialogHeader>
        <DialogTitle>Create maintenance job</DialogTitle>
        <DialogDescription>A scheduled repair on {prefill.assetTag}. It shows on the asset and in Maintenance.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mx-title">Title</Label>
        <Input id="mx-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mx-description">What failed</Label>
        <Textarea id="mx-description" value={description} maxLength={5000} rows={4} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="line" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim() || saving} loading={saving}>
          Create job
        </Button>
      </DialogFooter>
    </form>
  );
}

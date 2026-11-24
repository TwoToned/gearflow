"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CrewRoleDoc } from "@/hooks/use-crew";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { crewRoleSchema, type CrewRoleFormValues } from "@/lib/validations/crew";
import { roleFormValues } from "./use-role-writes";

const EMPTY: CrewRoleFormValues = { name: "", description: "", department: "", color: "", rateType: "", isActive: true };
const RATE_TYPES = ["HOURLY", "DAILY", "FLAT"] as const;

function RateFields({ form, unit }: { form: ReturnType<typeof useForm<CrewRoleFormValues>>; unit: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="role-cost">Cost rate ($){unit}</Label>
        <Input id="role-cost" type="number" step="0.01" inputMode="decimal" className="font-mono" placeholder="blank is not $0" {...form.register("defaultRate")} />
        <p className="text-caption text-muted">What the crew member is paid.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="role-charge">Charge rate ($){unit}</Label>
        <Input id="role-charge" type="number" step="0.01" inputMode="decimal" className="font-mono" placeholder="blank is not $0" {...form.register("chargeRate")} />
        <p className="text-caption text-muted">What the quote charges. Blank = no auto-pricing.</p>
      </div>
    </div>
  );
}

function RateTypeField({ form }: { form: ReturnType<typeof useForm<CrewRoleFormValues>> }) {
  const value = form.watch("rateType") || "";
  return (
    <div className="space-y-1">
      <Label htmlFor="role-type">Rate type</Label>
      <Select value={value} onValueChange={(v) => form.setValue("rateType", v as (typeof RATE_TYPES)[number])}>
        <SelectTrigger id="role-type" aria-label="Rate type">
          <SelectValue placeholder="Select rate type">{value ? crewRateTypeLabels[value] : "Select rate type"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RATE_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {crewRateTypeLabels[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RoleForm({
  role,
  showRates,
  onCancel,
  onSave,
}: {
  role: CrewRoleDoc | null;
  showRates: boolean;
  onCancel: () => void;
  onSave: (values: CrewRoleFormValues) => Promise<boolean>;
}) {
  const form = useForm<CrewRoleFormValues>({ resolver: zodResolver(crewRoleSchema), defaultValues: role ? roleFormValues(role) : EMPTY });
  const [saving, setSaving] = React.useState(false);
  const rateType = form.watch("rateType") || "";
  const unit = rateType ? ` / ${crewRateTypeLabels[rateType].toLowerCase()}` : "";
  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    const ok = await onSave(values);
    setSaving(false);
    if (ok) onCancel();
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="role-name">Name</Label>
          <Input id="role-name" placeholder="e.g. Camera op" aria-invalid={!!form.formState.errors.name} {...form.register("name")} />
          {form.formState.errors.name && <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-dept">Department</Label>
          <Input id="role-dept" placeholder="e.g. Vision" {...form.register("department")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-color">Colour</Label>
          <Input id="role-color" type="color" className="p-1" {...form.register("color")} />
        </div>
        <RateTypeField form={form} />
      </div>
      {showRates ? <RateFields form={form} unit={unit} /> : <p className="text-caption text-muted">Cost and charge rates are visible to managers only.</p>}
      <div className="space-y-1">
        <Label htmlFor="role-desc">Description</Label>
        <Textarea id="role-desc" rows={2} placeholder="Optional" {...form.register("description")} />
      </div>
      <DialogFooter>
        <Button type="button" variant="line" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {role ? "Save" : "Create role"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** New role / Edit… (§9h.5). `role === undefined` = closed, `null` = new. */
export function RoleEditor({
  role,
  showRates,
  onOpenChange,
  onSave,
}: {
  role: CrewRoleDoc | null | undefined;
  showRates: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (role: CrewRoleDoc | null, values: CrewRoleFormValues) => Promise<boolean>;
}) {
  return (
    <Dialog open={role !== undefined} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>Roles set the cost rate crew get on a call and the charge rate on the quote.</DialogDescription>
        </DialogHeader>
        {role !== undefined && (
          <RoleForm key={role?.id ?? "new"} role={role} showRates={showRates} onCancel={() => onOpenChange(false)} onSave={(v) => onSave(role, v)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

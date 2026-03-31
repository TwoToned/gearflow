"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { subHireSchema, type SubHireFormValues } from "@/lib/validations/sub-hire";
import { createSubHire } from "@/server/sub-hires";
import { getSuppliers } from "@/server/suppliers";
import { getProjects } from "@/server/projects";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { useActiveOrganization } from "@/lib/auth-client";

interface SubHireFormProps {
  defaultProjectId?: string;
}

export function SubHireForm({ defaultProjectId }: SubHireFormProps) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const form = useForm<SubHireFormValues>({
    resolver: zodResolver(subHireSchema),
    defaultValues: {
      supplierId: "",
      projectId: defaultProjectId || "",
      showOnDocs: false,
      notes: "",
    },
  });

  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: () => getSuppliers(),
  });
  const supplierOptions = (suppliersData || []).map((s: Record<string, unknown>) => ({
    value: s.id as string,
    label: s.name as string,
  }));

  const { data: projectsData } = useQuery({
    queryKey: ["projects", orgId, { pageSize: 200 }],
    queryFn: () => getProjects({ pageSize: 200 }),
  });
  const projectOptions = ((projectsData as Record<string, unknown>)?.projects as Array<Record<string, unknown>> || []).map((p) => ({
    value: p.id as string,
    label: `${p.projectNumber} - ${p.name}`,
  }));

  const mutation = useMutation({
    mutationFn: (data: SubHireFormValues) => createSubHire(data),
    onSuccess: (result: Record<string, unknown>) => {
      toast.success("Sub-hire created");
      router.push(`/sub-hires/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
      {/* Supplier */}
      <div className="space-y-2">
        <Label>Supplier</Label>
        <Controller
          control={form.control}
          name="supplierId"
          render={({ field }) => (
            <ComboboxPicker
              value={field.value || ""}
              onChange={field.onChange}
              options={supplierOptions}
              placeholder="Select supplier..."
              searchPlaceholder="Search suppliers..."
              emptyMessage="No suppliers found."
            />
          )}
        />
        {form.formState.errors.supplierId && (
          <p className="text-sm text-destructive">{form.formState.errors.supplierId.message}</p>
        )}
      </div>

      {/* Project (optional) */}
      <div className="space-y-2">
        <Label>Project (optional)</Label>
        <Controller
          control={form.control}
          name="projectId"
          render={({ field }) => (
            <ComboboxPicker
              value={field.value || ""}
              onChange={field.onChange}
              options={projectOptions}
              placeholder="Select project..."
              searchPlaceholder="Search projects..."
              emptyMessage="No projects found."
              allowClear
            />
          )}
        />
      </div>

      {/* Dates */}
      <div className="border-t border-border pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Hire Start</Label>
            <Input type="date" {...form.register("hireStart")} />
          </div>
          <div className="space-y-2">
            <Label>Hire End</Label>
            <Input type="date" {...form.register("hireEnd")} />
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="border-t border-border pt-4">
        <Controller
          control={form.control}
          name="showOnDocs"
          render={({ field }) => (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Show on client documents</div>
                <div className="text-xs text-fg-3">
                  When enabled, sub-hired items appear on quotes, invoices, and packing lists
                </div>
              </div>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
      </div>

      {/* Notes */}
      <div className="border-t border-border pt-4 space-y-2">
        <Label>Notes</Label>
        <Textarea
          {...form.register("notes")}
          placeholder="Optional notes about this sub-hire..."
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Sub-Hire
        </Button>
      </div>
    </form>
  );
}

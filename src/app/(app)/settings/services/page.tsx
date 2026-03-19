"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Pencil,
  Trash2,
  Truck,
  PackageCheck,
  ArrowDownToLine,
  ArrowUpFromLine,
  HardHat,
  Wrench,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import {
  getServiceTemplates,
  createServiceTemplate,
  updateServiceTemplate,
  deleteServiceTemplate,
} from "@/server/project-services";
import {
  serviceTemplateSchema,
  type ServiceTemplateFormValues,
} from "@/lib/validations/project-service";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ServiceType = "DELIVERY" | "PICKUP" | "BUMP_IN" | "BUMP_OUT" | "LABOUR" | "MISC";

const SERVICE_TYPE_ICONS: Record<ServiceType, typeof Truck> = {
  DELIVERY: Truck,
  PICKUP: PackageCheck,
  BUMP_IN: ArrowDownToLine,
  BUMP_OUT: ArrowUpFromLine,
  LABOUR: HardHat,
  MISC: Wrench,
};

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  BUMP_IN: "Bump In",
  BUMP_OUT: "Bump Out",
  LABOUR: "Labour",
  MISC: "Misc",
};

const PRICING_TYPE_LABELS: Record<string, string> = {
  FLAT: "Flat",
  PER_HOUR: "Per Hour",
  PER_DAY: "Per Day",
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${Number(value).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

export default function ServiceTemplatesPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const canEdit = useCanDo("orgSettings", "update");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["service-templates", orgId],
    queryFn: () => getServiceTemplates(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteServiceTemplate(id),
    onSuccess: () => {
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ["service-templates", orgId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="t-heading text-fg">Service Templates</h2>
          <p className="text-[12px] text-fg-3">
            Define default services that can be quickly added to projects.
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Template
          </Button>
        )}
      </div>

      <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-fg-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-3">
            <Truck className="mb-2 h-8 w-8 opacity-50" />
            <p>No service templates yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Default Price</TableHead>
                <TableHead>On Docs</TableHead>
                <TableHead>Auto-Add</TableHead>
                <TableHead>Active</TableHead>
                {canEdit && <TableHead className="w-[80px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(templates as Record<string, unknown>[]).map((t) => {
                const Icon = SERVICE_TYPE_ICONS[t.type as ServiceType];
                return (
                  <TableRow key={t.id as string}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {SERVICE_TYPE_LABELS[t.type as ServiceType]}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{t.title as string}</TableCell>
                    <TableCell>
                      {t.defaultUnitPrice != null
                        ? `${formatCurrency(t.defaultUnitPrice as number)} ${
                            t.defaultPricingType
                              ? PRICING_TYPE_LABELS[t.defaultPricingType as string] || ""
                              : ""
                          }`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {t.showOnDocuments ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.isAutoAdded ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                          Auto
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Manual</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(t);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm(`Delete template "${t.title}"?`)) {
                                deleteMutation.mutate(t.id as string);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Record<string, unknown> | null;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const isEditing = !!editing;

  const defaultValues: ServiceTemplateFormValues = editing
    ? {
        type: editing.type as ServiceType,
        title: editing.title as string,
        description: (editing.description as string) || "",
        defaultCrewCount: (editing.defaultCrewCount as number) || undefined,
        defaultVehicle: (editing.defaultVehicle as string) || "",
        defaultPricingType: (editing.defaultPricingType as "PER_DAY" | "PER_HOUR" | "FLAT" | "") || "",
        defaultUnitPrice: (editing.defaultUnitPrice as number) || undefined,
        showOnDocuments: (editing.showOnDocuments as boolean) || false,
        isAutoAdded: (editing.isAutoAdded as boolean) || false,
        isActive: editing.isActive !== false,
      }
    : {
        type: "DELIVERY" as ServiceType,
        title: "",
        description: "",
        defaultPricingType: "",
        showOnDocuments: false,
        isAutoAdded: false,
        isActive: true,
      };

  const form = useForm<ServiceTemplateFormValues>({
    resolver: zodResolver(serviceTemplateSchema),
    defaultValues,
    values: open ? defaultValues : undefined,
  });

  const createMutation = useMutation({
    mutationFn: (data: ServiceTemplateFormValues) => createServiceTemplate(data),
    onSuccess: () => {
      toast.success("Template created");
      queryClient.invalidateQueries({ queryKey: ["service-templates", orgId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: ServiceTemplateFormValues) =>
      updateServiceTemplate(editing!.id as string, data),
    onSuccess: () => {
      toast.success("Template updated");
      queryClient.invalidateQueries({ queryKey: ["service-templates", orgId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function onSubmit(data: ServiceTemplateFormValues) {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Template" : "Add Service Template"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={form.watch("type")}
              onValueChange={(v) => form.setValue("type", v as ServiceType)}
            >
              <SelectTrigger>
                <SelectValue>
                  {SERVICE_TYPE_LABELS[form.watch("type") as ServiceType]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {SERVICE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input {...form.register("title")} placeholder="Template title" />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              placeholder="Optional description..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Default Price</Label>
              <Input
                type="number"
                step="0.01"
                {...form.register("defaultUnitPrice")}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pricing Type</Label>
              <Select
                value={form.watch("defaultPricingType") || ""}
                onValueChange={(v) => form.setValue("defaultPricingType", v as "PER_DAY" | "PER_HOUR" | "FLAT" | "")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {form.watch("defaultPricingType")
                      ? PRICING_TYPE_LABELS[form.watch("defaultPricingType") as string]
                      : "Select..."}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FLAT">Flat</SelectItem>
                  <SelectItem value="PER_HOUR">Per Hour</SelectItem>
                  <SelectItem value="PER_DAY">Per Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Default Crew Count</Label>
              <Input
                type="number"
                min={0}
                {...form.register("defaultCrewCount")}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default Vehicle</Label>
              <Input
                {...form.register("defaultVehicle")}
                placeholder="e.g. Sprinter van"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="tmpl-showOnDocs"
                checked={form.watch("showOnDocuments")}
                onCheckedChange={(checked) =>
                  form.setValue("showOnDocuments", !!checked)
                }
              />
              <Label htmlFor="tmpl-showOnDocs" className="text-sm font-normal cursor-pointer">
                Show on documents by default
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="tmpl-autoAdd"
                checked={form.watch("isAutoAdded")}
                onCheckedChange={(checked) =>
                  form.setValue("isAutoAdded", !!checked)
                }
              />
              <Label htmlFor="tmpl-autoAdd" className="text-sm font-normal cursor-pointer">
                Auto-add to new projects
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="tmpl-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) =>
                  form.setValue("isActive", !!checked)
                }
              />
              <Label htmlFor="tmpl-active" className="text-sm font-normal cursor-pointer">
                Active
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

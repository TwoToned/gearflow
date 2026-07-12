"use client";

import { useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ClipboardCheck,
  CheckCircle2,
  FileText,
  Ruler,
  ListChecks,
  X,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";

import {
  createCheckItem,
  updateCheckItem,
  deleteCheckItem,
} from "@/server/check-items";
import { useCheckItems } from "@/hooks/use-check-items";
import { useModelCheckItemUsageCounts } from "@/hooks/use-check-item-assignments";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  checkItemSchema,
  type CheckItemFormValues,
} from "@/lib/validations/check-item";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { FadeIn } from "@/components/ui/motion";

import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
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
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";

const TYPE_LABELS: Record<CheckItemType, string> = {
  PASS_FAIL: "Pass / Fail",
  NOTES: "Notes",
  MEASUREMENT: "Measurement",
  DROPDOWN: "Dropdown",
};

const TYPE_ICONS: Record<CheckItemType, typeof CheckCircle2> = {
  PASS_FAIL: CheckCircle2,
  NOTES: FileText,
  MEASUREMENT: Ruler,
  DROPDOWN: ListChecks,
};

const TYPE_COLORS: Record<CheckItemType, string> = {
  PASS_FAIL: "bg-green-500/10 text-green-500 border-green-500/20",
  NOTES: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  MEASUREMENT: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  DROPDOWN: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

export default function CheckItemsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canCreate = useCanDo("checkItem", "create");
  const canEdit = useCanDo("checkItem", "update");
  const canDelete = useCanDo("checkItem", "delete");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Reactive check-item library straight from Convex (auto-updates on any
  // create/update/delete). The per-item model-usage count is now reactive too —
  // derived from the dual-written `modelCheckItems` table (the old server action
  // also fetched a check-record count that this page never rendered).
  const allCheckItems = useCheckItems(orgId);
  const modelUsageCounts = useModelCheckItemUsageCounts(orgId);
  const isLoading = allCheckItems === undefined;

  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => deleteCheckItem(id),
    onSuccess: () => {
      toast.success("Check item deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  // Sort by [category, label] (Convex list is unordered) + merge usage counts.
  const items = useMemo(() => {
    const source = (allCheckItems ?? []) as Record<string, unknown>[];
    const sorted = [...source].sort((a, b) => {
      const ca = ((a.category as string) || "").localeCompare((b.category as string) || "", undefined, { sensitivity: "base" });
      return ca !== 0 ? ca : (a.label as string).localeCompare(b.label as string, undefined, { sensitivity: "base" });
    });
    return sorted.map((i) => ({ ...i, _count: { modelCheckItems: modelUsageCounts?.get(i.id as string) ?? 0 } })) as Record<string, unknown>[];
  }, [allCheckItems, modelUsageCounts]);
  const filtered = searchQuery
    ? items.filter(
        (i) =>
          (i.label as string).toLowerCase().includes(searchQuery.toLowerCase()) ||
          ((i.category as string) || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  const grouped = filtered.reduce<Record<string, Record<string, unknown>[]>>(
    (acc, item) => {
      const cat = (item.category as string) || "Uncategorized";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {}
  );

  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  // Mobile card layout for the check-item library (rendered below `md`). Cells
  // reuse the exact desktop TableCell JSX; the list is the same flat, sorted
  // `filtered` order the desktop table renders.
  const cols: ColumnDef<Record<string, unknown>>[] = [
    {
      id: "label",
      header: "Label",
      mobile: "title",
      cell: (item) => (
        <div>
          <span className="font-medium">{item.label as string}</span>
          {item.description ? (
            <p className="mt-0.5 text-xs text-fg-3 line-clamp-1">
              {item.description as string}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      mobile: "badge",
      cell: (item) => {
        const type = item.type as CheckItemType;
        const Icon = TYPE_ICONS[type];
        return (
          <Badge status="neutral" className={TYPE_COLORS[type]}>
            <Icon className="mr-1 h-3 w-3" />
            {TYPE_LABELS[type]}
          </Badge>
        );
      },
    },
    {
      id: "category",
      header: "Category",
      mobile: "meta",
      cell: (item) => (item.category as string) || "—",
    },
    {
      id: "usage",
      header: "Usage",
      mobile: "meta",
      cell: (item) => {
        const count = item._count as { modelCheckItems: number } | undefined;
        return `${count?.modelCheckItems ?? 0} model${(count?.modelCheckItems ?? 0) !== 1 ? "s" : ""}`;
      },
    },
  ];
  if (canEdit || canDelete) {
    cols.push({
      id: "actions",
      header: "Actions",
      mobile: "actions",
      cell: (item) => (
        <div className="flex items-center gap-1">
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(item);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() =>
                setDeleteTarget({
                  id: item.id as string,
                  label: item.label as string,
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <FadeIn>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="t-heading text-fg">Check Items</h2>
            <p className="text-[12px] text-fg-3">
              Define quality check items that can be assigned to models for warehouse prep &amp; return.
            </p>
          </div>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Check Item
            </Button>
          )}
        </div>

        {items.length > 5 && (
          <Input
            placeholder="Search check items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-xs"
          />
        )}

        <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-fg-3">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-fg-3">
              <ClipboardCheck className="mb-2 h-8 w-8 opacity-50" />
              <p className="font-medium">
                {items.length === 0 ? "No check items yet" : "No matching items"}
              </p>
              <p className="mt-1 text-xs">
                {items.length === 0
                  ? "Create check items here, then assign them to models."
                  : "Try a different search term."}
              </p>
            </div>
          ) : (
            <>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="hidden md:table-cell">Usage</TableHead>
                  {(canEdit || canDelete) && <TableHead className="w-[80px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCategories.map((category) =>
                  grouped[category].map((item) => {
                    const type = item.type as CheckItemType;
                    const Icon = TYPE_ICONS[type];
                    const count = item._count as { modelCheckItems: number } | undefined;
                    return (
                      <TableRow key={item.id as string}>
                        <TableCell>
                          <div>
                            <span className="font-medium">{item.label as string}</span>
                            {item.description ? (
                              <p className="mt-0.5 text-xs text-fg-3 line-clamp-1">
                                {item.description as string}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge status="neutral" className={TYPE_COLORS[type]}>
                            <Icon className="mr-1 h-3 w-3" />
                            {TYPE_LABELS[type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-fg-3 text-sm">
                          {(item.category as string) || "—"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-fg-3 text-sm">
                          {count?.modelCheckItems ?? 0} model{(count?.modelCheckItems ?? 0) !== 1 ? "s" : ""}
                        </TableCell>
                        {(canEdit || canDelete) && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditing(item);
                                    setDialogOpen(true);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() =>
                                    setDeleteTarget({
                                      id: item.id as string,
                                      label: item.label as string,
                                    })
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
            <MobileCardList
              className="md:hidden"
              data={filtered}
              columns={cols}
              getRowId={(r) => r.id as string}
            />
            </>
          )}
        </div>

        <CheckItemDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
        />

        <DeleteDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={`Delete "${deleteTarget?.label ?? ""}"?`}
          description="This removes the check item from new model/kit templates. Existing checklist instances on past projects are preserved."
          confirmLabel="Delete check item"
          onConfirm={() => {
            if (deleteTarget) {
              deleteMutation.mutate(deleteTarget.id);
              setDeleteTarget(null);
            }
          }}
          pending={deleteMutation.isPending}
        />
      </div>
    </FadeIn>
  );
}

// ─── Check Item Dialog ──────────────────────────────────────────────────────

function CheckItemDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Record<string, unknown> | null;
}) {
  const isEditing = !!editing;

  const defaultValues: CheckItemFormValues = editing
    ? {
        label: editing.label as string,
        description: (editing.description as string) || "",
        type: editing.type as CheckItemType,
        category: (editing.category as string) || "",
        measurementUnit: (editing.measurementUnit as string) || "",
        measurementMin: (editing.measurementMin as number) || undefined,
        measurementMax: (editing.measurementMax as number) || undefined,
        dropdownOptions: (editing.dropdownOptions as { label: string; isFail: boolean }[]) || [],
      }
    : {
        label: "",
        description: "",
        type: "PASS_FAIL" as CheckItemType,
        category: "",
        measurementUnit: "",
        dropdownOptions: [],
      };

  const form = useForm<CheckItemFormValues>({
    resolver: zodResolver(checkItemSchema),
    defaultValues,
    values: open ? defaultValues : undefined,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "dropdownOptions" as never,
  });

  const watchType = form.watch("type");

  // No invalidation: every check-item-library reader (this page + the model-table
  // bulk-assign dialog) subscribes to Convex, so the dual-write server action's
  // Convex write pushes the update live.
  const createMutation = useServerMutation({
    mutationFn: (data: CheckItemFormValues) => createCheckItem(data),
    onSuccess: () => {
      toast.success("Check item created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: CheckItemFormValues) =>
      updateCheckItem(editing!.id as string, data),
    onSuccess: () => {
      toast.success("Check item updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function onSubmit(data: CheckItemFormValues) {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Check Item" : "Add Check Item"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              {...form.register("label")}
              placeholder="e.g. Power cable intact"
            />
            {form.formState.errors.label && (
              <p className="text-xs text-destructive">
                {form.formState.errors.label.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              {...form.register("description")}
              placeholder="Optional instructions for the person performing the check..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={watchType}
                onValueChange={(v) => form.setValue("type", v as CheckItemType)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {TYPE_LABELS[watchType as CheckItemType] || "Select..."}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as CheckItemType[]).map((t) => {
                    const Icon = TYPE_ICONS[t];
                    return (
                      <SelectItem key={t} value={t}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          {TYPE_LABELS[t]}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input
                {...form.register("category")}
                placeholder="e.g. Electrical"
              />
            </div>
          </div>

          {/* Measurement-specific fields */}
          {watchType === "MEASUREMENT" && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-xs font-medium text-fg-2">Measurement Thresholds</p>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Input
                  {...form.register("measurementUnit")}
                  placeholder="e.g. volts, mm, PSI"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Min</Label>
                  <Input
                    type="number"
                    step="any"
                    {...form.register("measurementMin")}
                    placeholder="Min threshold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max</Label>
                  <Input
                    type="number"
                    step="any"
                    {...form.register("measurementMax")}
                    placeholder="Max threshold"
                  />
                </div>
              </div>
              {form.formState.errors.measurementMin && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.measurementMin.message}
                </p>
              )}
              <p className="text-xs text-fg-3">
                Values within range auto-pass. Values outside auto-fail.
              </p>
            </div>
          )}

          {/* Dropdown-specific fields */}
          {watchType === "DROPDOWN" && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-fg-2">Dropdown Options</p>
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  onClick={() => append({ label: "", isFail: false })}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Option
                </Button>
              </div>
              {fields.length === 0 && (
                <p className="text-xs text-fg-3">
                  Add at least 2 options. Mark options as &quot;Fail&quot; to trigger fail results.
                </p>
              )}
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                    <Input
                      {...form.register(`dropdownOptions.${index}.label`)}
                      placeholder="Option label"
                      className="flex-1"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Checkbox
                        id={`opt-fail-${index}`}
                        checked={form.watch(`dropdownOptions.${index}.isFail`)}
                        onCheckedChange={(checked) =>
                          form.setValue(`dropdownOptions.${index}.isFail`, !!checked)
                        }
                      />
                      <Label
                        htmlFor={`opt-fail-${index}`}
                        className="text-xs font-normal cursor-pointer text-destructive"
                      >
                        Fail
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      className="h-7 w-7 p-0 shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              {form.formState.errors.dropdownOptions && (
                <p className="text-xs text-destructive">
                  {typeof form.formState.errors.dropdownOptions === "object" &&
                  "message" in form.formState.errors.dropdownOptions
                    ? (form.formState.errors.dropdownOptions.message as string)
                    : "At least 2 options required"}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="line"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

/**
 * Custom field settings (Wave 3).
 *
 * Define operator-specific attributes that appear on the asset create /
 * edit form. v1 is asset-scoped; the CustomFieldDefinition.entityType enum
 * leaves room for kit / project / bulk-asset later.
 */

import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, GripVertical, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { useCustomFieldDefinitions } from "@/hooks/use-custom-fields";
import { useCustomFieldWrites } from "@/hooks/use-custom-fields-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  customFieldDefinitionSchema,
  type CustomFieldDefinitionInput,
} from "@/lib/validations/custom-field";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { showError } from "@/lib/show-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = any;

const FIELD_TYPES = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "SELECT", label: "Dropdown" },
  { value: "BOOLEAN", label: "Yes / No" },
] as const;

/** Derive a JSON-safe key from a label: "Rig Number" → "rigNumber". */
function deriveKey(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  return (
    cleaned[0].toLowerCase() +
    cleaned
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("")
  );
}

function FieldDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Def | null;
}) {
  const isEdit = !!editing;
  const [optionsText, setOptionsText] = useState(
    editing?.options?.join("\n") ?? "",
  );

  const form = useForm<CustomFieldDefinitionInput>({
    resolver: zodResolver(customFieldDefinitionSchema),
    defaultValues: {
      entityType: "ASSET",
      label: editing?.label ?? "",
      fieldKey: editing?.fieldKey ?? "",
      fieldType: editing?.fieldType ?? "TEXT",
      options: editing?.options ?? [],
      required: editing?.required ?? false,
      helpText: editing?.helpText ?? "",
      sortOrder: editing?.sortOrder ?? 0,
      isActive: editing?.isActive ?? true,
    },
  });

  const fieldType = form.watch("fieldType");
  const label = form.watch("label");
  const writes = useCustomFieldWrites();

  const mutation = useServerMutation({
    mutationFn: (data: CustomFieldDefinitionInput) => {
      const options = optionsText
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (isEdit) {
        return writes.update(editing.id, {
          label: data.label,
          fieldType: data.fieldType ?? "TEXT",
          options,
          required: data.required ?? false,
          helpText: data.helpText,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
        });
      }
      return writes.create({ ...data, options });
    },
    onSuccess: () => {
      // No invalidation: the page (useCustomFieldDefinitions) and the field
      // input/display consumers (useActiveCustomFields) subscribe to Convex, so
      // the dual-write server action's Convex write pushes the update live.
      toast.success(isEdit ? "Custom field updated" : "Custom field added");
      onOpenChange(false);
    },
    onError: (e) => showError(e),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit custom field" : "New custom field"}</DialogTitle>
          <DialogDescription>
            Appears on the asset create and edit forms.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="cf-label">Label</Label>
            <Input
              id="cf-label"
              {...form.register("label")}
              placeholder="e.g. Rig Number"
              onChange={(e) => {
                form.setValue("label", e.target.value);
                // Auto-derive the key while creating (key is immutable on edit)
                if (!isEdit) {
                  form.setValue("fieldKey", deriveKey(e.target.value));
                }
              }}
            />
            {form.formState.errors.label && (
              <p className="text-xs text-destructive">{form.formState.errors.label.message}</p>
            )}
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="cf-key">Key</Label>
              <Input id="cf-key" {...form.register("fieldKey")} className="font-mono text-sm" />
              <p className="text-[11px] text-fg-4">
                Stable identifier — auto-filled from the label{label ? "" : ""}. Can&apos;t change later.
              </p>
              {form.formState.errors.fieldKey && (
                <p className="text-xs text-destructive">{form.formState.errors.fieldKey.message}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cf-type">Type</Label>
            <select
              id="cf-type"
              {...form.register("fieldType")}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {fieldType === "SELECT" && (
            <div className="space-y-2">
              <Label htmlFor="cf-options">Options (one per line)</Label>
              <Textarea
                id="cf-options"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                placeholder={"Small\nMedium\nLarge"}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cf-help">Help text (optional)</Label>
            <Input id="cf-help" {...form.register("helpText")} placeholder="Shown under the input" />
          </div>

          <Controller
            control={form.control}
            name="required"
            render={({ field }) => (
              <label className="flex items-center gap-2">
                <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                <span className="text-sm">Required field</span>
              </label>
            )}
          />

          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save" : "Add field"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomFieldsSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Def | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Def | null>(null);
  const writes = useCustomFieldWrites();

  // Reactive custom-field list straight from Convex (auto-updates on any
  // create/update/delete/reorder). The Convex list returns ALL entity types for
  // the org; this v1 settings page is ASSET-scoped, so filter + sort client-side.
  const allDefs = useCustomFieldDefinitions(orgId);
  const isLoading = allDefs === undefined;

  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => writes.remove(id),
    onSuccess: () => {
      // Reactive: consumers subscribe to Convex (see create/update above).
      toast.success("Custom field removed");
      setDeleteTarget(null);
    },
    onError: (e) => showError(e),
  });

  const list = useMemo(() => {
    const source = (allDefs ?? []) as unknown as Def[];
    return source
      .filter((d) => (d as { entityType?: string }).entityType === "ASSET")
      .sort((a, b) => {
        const so = ((a as { sortOrder?: number }).sortOrder ?? 0) - ((b as { sortOrder?: number }).sortOrder ?? 0);
        return so !== 0 ? so : 0;
      });
  }, [allDefs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom Fields"
        description="Operator-defined attributes for assets — rig numbers, firmware versions, road-case colours, anything your team needs to track."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" />
            New field
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-fg-3">Loading…</p>
      ) : list.length === 0 ? (
        <div className="rounded-md border bg-bg-surface p-6 text-center text-sm text-fg-3">
          No custom fields yet. Add one and it&apos;ll appear on every asset&apos;s
          create and edit form.
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {list.map((def) => (
            <div key={def.id} className="flex items-center gap-3 px-3 py-2.5">
              <GripVertical className="size-4 shrink-0 text-fg-4" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{def.label}</span>
                  <code className="rounded bg-bg-inset px-1 text-[11px] text-fg-3">
                    {def.fieldKey}
                  </code>
                  {!def.isActive && (
                    <Badge status="neutral" className="text-fg-4">Hidden</Badge>
                  )}
                  {def.required && (
                    <Badge status="neutral" className="border-amber-500/40 text-amber-600">
                      Required
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-fg-4">
                  {FIELD_TYPES.find((t) => t.value === def.fieldType)?.label ?? def.fieldType}
                  {def.fieldType === "SELECT" && def.options.length > 0
                    ? ` · ${def.options.length} option${def.options.length === 1 ? "" : "s"}`
                    : ""}
                  {def.helpText ? ` · ${def.helpText}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => {
                  setEditing(def);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-destructive"
                onClick={() => setDeleteTarget(def)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <FieldDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
        />
      )}

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove custom field?"
        description={
          deleteTarget
            ? `"${deleteTarget.label}" will stop appearing on asset forms. Values already saved on assets are kept but hidden.`
            : ""
        }
        confirmLabel="Remove field"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        pending={deleteMutation.isPending}
      />
    </div>
  );
}

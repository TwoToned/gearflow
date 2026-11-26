"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { Input } from "@/components/ui/input";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SmartFormField, SmartFormSection } from "@/components/ui/smart-form";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { useMemberRoster } from "@/hooks/use-member-roster";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import {
  assetsEditable,
  buildMaintenanceCreate,
  buildMaintenanceEdit,
  EMPTY_MAINTENANCE_VALUES,
  maintenanceSheetError,
  type MaintenanceSheetInitial,
  type MaintenanceSheetValues,
} from "@/lib/maintenance-sheet";
import { showError } from "@/lib/show-error";
import { maintenanceTypeLabels } from "@/lib/status-labels";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import { MAINTENANCE_PHOTO_FOLDER } from "../../../convex/lib/maintenancePhotoFolder";

const TYPES = ["REPAIR", "PREVENTATIVE", "TEST_AND_TAG", "INSPECTION", "CLEANING", "FIRMWARE_UPDATE"] as const;
const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit this record. Absent = log a new job. */
  record?: MaintenanceSheetInitial;
}

function valuesOf(record?: MaintenanceSheetInitial): MaintenanceSheetValues {
  if (!record) return EMPTY_MAINTENANCE_VALUES;
  const { id: _id, status: _status, labourVisible: _visible, ...values } = record;
  void _id; void _status; void _visible;
  return values;
}

/** The asset builder: a picker plus the chosen assets as removable rows (read-only once the job is under way). */
function AssetsField({ ids, options, editable, onChange }: { ids: string[]; options: { value: string; label: string }[]; editable: boolean; onChange: (ids: string[]) => void }) {
  const label = (id: string) => options.find((o) => o.value === id)?.label ?? id;
  return (
    <div>
      {editable && (
        <ComboboxPicker
          value=""
          onChange={(val) => val && !ids.includes(val) && onChange([...ids, val])}
          options={options.filter((o) => !ids.includes(o.value))}
          placeholder="Search and select assets…"
          searchPlaceholder="Search by tag, model, or name…"
          emptyMessage="No assets found."
        />
      )}
      {ids.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {ids.map((id) => (
            <div key={id} className="flex items-center gap-1 rounded-[var(--r)] border border-line bg-paper-2 py-1 pl-2.5 pr-1 text-ui-text text-ink">
              <span className="min-w-0 break-words">{label(id)}</span>
              {editable && (
                <button type="button" onClick={() => onChange(ids.filter((x) => x !== id))} className={cn("ml-auto shrink-0 rounded-full p-0.5 text-muted transition-colors hover:bg-elev hover:text-ink", focusRing)} aria-label={`Remove ${label(id)}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A member picker whose first row clears the field. */
function PersonSelect({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (v: string) => void }) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger aria-label={label}><SelectValue placeholder="Nobody">{options.find((o) => o.id === value)?.name ?? "Nobody"}</SelectValue></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Nobody</SelectItem>
        {options.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * The Maintenance sheet (UX Phase 14, 14b-3, §9n.3): log a job and edit one in ONE sheet on `FormSheet`. There is NO
 * status field: a job's status moves only through Complete / Reopen. Edit carries exactly the fields the edit write sets
 * (so a save never clears another), a blank box clears its field, and labour appears only for a caller whose read carried
 * it. The asset list is editable while the job is Scheduled; after that the assets are held and Complete / Reopen own them.
 * Every save toasts with the exact Undo of its own audit id; a save that changed nothing says so and offers none.
 */
export function MaintenanceSheet({ open, onOpenChange, record }: Props) {
  const router = useRouter();
  const editing = !!record;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useMaintenanceWrites();
  const assets = useAuthedQuery(api.maintenanceRecords.assetsForSelect, orgId && open ? { orgId } : "skip");
  const { options: members } = useMemberRoster(orgId);
  const orgTags = useOrgTags(orgId);
  const [values, setValues] = React.useState<MaintenanceSheetValues>(() => valuesOf(record));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValues(valuesOf(record));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the sheet opens or its target changes
  }, [open, record?.id]);

  const set = <K extends keyof MaintenanceSheetValues>(k: K, v: MaintenanceSheetValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const editableAssets = !editing || assetsEditable(record.status);
  const labourVisible = editing && record.labourVisible;
  const assetOptions = (assets ?? []).map((a: { id: string; label: string }) => ({ value: a.id, label: a.label }));

  const saveEdit = async () => {
    const r = await writes.edit(record!.id, buildMaintenanceEdit(values, record!));
    if (!r.changed) toast("Nothing changed");
    else if (!r.undoable) toast.success(`Updated ${values.title.trim()}`, { description: "A removed photo was deleted, so this can't be undone." });
    else announceListWrite({ title: `Updated ${values.title.trim()}`, undoneTitle: "Change undone", performUndo: async () => void (await writes.undoEdit(record!.id, r.auditId)) });
    onOpenChange(false);
  };

  const saveCreate = async () => {
    const r = await writes.create(buildMaintenanceCreate(values));
    announceListWrite({ title: `Logged ${values.title.trim()}`, undoneTitle: `Removed ${values.title.trim()}`, performUndo: async () => void (await writes.undoCreate(r.id)) });
    onOpenChange(false);
    router.push(`/maintenance/${r.id}`);
  };

  const submit = async () => {
    const problem = maintenanceSheetError(values, { labourVisible, editingAssets: editableAssets });
    if (problem) return void toast.error(problem);
    setSaving(true);
    try {
      await (editing ? saveEdit() : saveCreate());
    } catch (e) {
      showError(e, { fallbackTitle: editing ? "Could not save the job" : "Could not log the job" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${record.title}` : "Log maintenance"}
      description={editing ? undefined : "Log a repair, inspection or other work. Add parts and complete it from the job's page."}
      primaryLabel={editing ? "Save" : "Log job"}
      onSubmit={submit}
      submitting={saving || uploading}
      dirty={dirty}
    >
      <div className="space-y-6">
        <SmartFormSection title="Job" hint="What is being worked on and why." divider={false}>
          <div className="space-y-4">
            <SmartFormField label="Assets" required hint={editableAssets ? undefined : "These are held while the job is under way. Complete or Reopen the job to change them."}>
              <AssetsField ids={values.assetIds} options={assetOptions} editable={editableAssets} onChange={(ids) => set("assetIds", ids)} />
            </SmartFormField>
            <SmartFormField label="Title" required>
              <Input value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Brief description" autoFocus={!editing} aria-label="Title" />
            </SmartFormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <SmartFormField label="Type">
                <Select value={values.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger aria-label="Type"><SelectValue>{maintenanceTypeLabels[values.type] ?? values.type}</SelectValue></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{maintenanceTypeLabels[t]}</SelectItem>)}</SelectContent>
                </Select>
              </SmartFormField>
              <SmartFormField label="Assigned to"><PersonSelect label="Assigned to" value={values.assignedToId} options={members} onChange={(v) => set("assignedToId", v)} /></SmartFormField>
              <SmartFormField label="Reported by"><PersonSelect label="Reported by" value={values.reportedById} options={members} onChange={(v) => set("reportedById", v)} /></SmartFormField>
            </div>
            <SmartFormField label="Description">
              <Textarea value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="Detailed notes about the work…" rows={3} aria-label="Description" />
            </SmartFormField>
          </div>
        </SmartFormSection>

        <SmartFormSection title="Schedule" hint="When the work is planned, and when it is next due.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SmartFormField label="Scheduled date"><Input type="date" value={values.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} aria-label="Scheduled date" /></SmartFormField>
            <SmartFormField label="Next due"><Input type="date" value={values.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)} aria-label="Next due" /></SmartFormField>
          </div>
        </SmartFormSection>

        <details open={editing} className="border-t border-line pt-4">
          <summary className="cursor-pointer text-ui-text font-medium text-ink">More details</summary>
          <div className="space-y-4 pt-3">
            {labourVisible && (
              <SmartFormField label="Labour ($)" hint="Blank means not entered. Parts are added on the Parts tab.">
                <Input type="number" step="0.01" min={0} value={values.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" aria-label="Labour" />
              </SmartFormField>
            )}
            <SmartFormField label="Photos" hint="Up to 20 photos. Phones use the rear camera.">
              <PhotoGridInput value={values.photos} onChange={(urls) => set("photos", urls)} onUploadingChange={setUploading} folder={MAINTENANCE_PHOTO_FOLDER} />
            </SmartFormField>
            <SmartFormField label="Tags"><TagInput value={values.tags} onChange={(t) => set("tags", t)} suggestions={orgTags} placeholder="Add tags…" /></SmartFormField>
          </div>
        </details>
      </div>
    </FormSheet>
  );
}

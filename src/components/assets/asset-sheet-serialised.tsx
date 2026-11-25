"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useActiveOrganization } from "@/lib/auth-client";
import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { activeMilestoneKey } from "@/lib/activation-milestones";
import { peekNextAssetTags } from "@/server/settings";
import { assetSchema, type AssetFormValues } from "@/lib/validations/asset";
import { FormSheet } from "@/components/ui/form-sheet";
import { SheetMore } from "@/components/ui/sheet-parts";
import { QuickCreateLocation } from "./quick-create-location";
import { QuickCreateSupplier } from "./quick-create-supplier";
import { QuickCreateSupplierOrder } from "./quick-create-supplier-order";
import { ConditionFields, IdentityFields, PurchaseFields, type SheetDialogKey } from "./asset-sheet-serialised-fields";
import { useAssetSheetLookups } from "./use-asset-sheet-lookups";
import { useSerialisedSave } from "./use-serialised-save";
import { useTagTaken } from "./use-tag-taken";

export interface SerialisedSheetProps {
  mode: "create" | "edit";
  /** Edit: the record. Create: prefill (New asset like this, a model's New asset). */
  values: AssetFormValues & { id?: string };
  onClose: () => void;
  onSaved?: (r: { id: string; again?: boolean }) => void;
  onImportCsv?: () => void;
  /** Create words: `Serialised unit · Bulk stock`. */
  words?: React.ReactNode;
}

/** Create: pre-fill the next tag (a preview; it is reserved on save). */
function usePrefillTag(editing: boolean, hasTag: boolean, setTag: (tag: string) => void) {
  useEffect(() => {
    if (editing || hasTag) return;
    let live = true;
    peekNextAssetTags(1)
      .then(([tag]) => live && setTag(tag))
      .catch(() => undefined); // advisory: the person can still type a tag
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened sheet
  }, []);
}

export function SerialisedSheet({ mode, values, onClose, onSaved, onImportCsv, words }: SerialisedSheetProps) {
  const router = useRouter();
  const editing = mode === "edit";
  const orgId = useActiveOrganization().data?.id;
  const milestones = useActivationMilestones(orgId);
  const tagTaken = useTagTaken(orgId, values.id);
  const form = useForm<AssetFormValues>({ resolver: zodResolver(assetSchema), mode: "onTouched", defaultValues: values });
  const supplierId = form.watch("supplierId");
  const lookups = useAssetSheetLookups(orgId, "serialized", supplierId);
  const [dialog, setDialog] = useState<SheetDialogKey | null>(null);
  // The early "already used" answer lives in its own state: the form's blur validation would clear a message set after an async lookup.
  const [taken, setTaken] = useState<string | null>(null);

  usePrefillTag(editing, !!values.assetTag, (tag) => form.setValue("assetTag", tag, { shouldDirty: false }));
  const { saving, save } = useSerialisedSave({
    editing, id: values.id, form, tagTaken, setTaken, onClose, onSaved,
    milestone: { active: milestones != null && activeMilestoneKey(milestones) === "asset", firstModelId: milestones?.firstModelId },
  });
  const checkTag = async (tag: string) => setTaken(await tagTaken(tag));
  const closeDialog = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={editing ? `Edit ${values.assetTag || "asset"}` : "New asset"}
        description={editing ? "Notes live on the Notes tab." : "A serialised unit: tracked by its own tag."}
        primaryLabel={editing ? "Save" : "Create asset"}
        onSubmit={() => save(false)}
        submitting={saving}
        dirty={form.formState.isDirty}
        addAnother={editing ? undefined : { label: "Save and add another", onSelect: () => save(true) }}
        footerStart={!editing && onImportCsv ? <button type="button" onClick={onImportCsv} className="min-h-11 text-table-cell text-ink-2 underline-offset-4 hover:underline">Import CSV…</button> : undefined}
      >
        <div className="space-y-6">
          {words}
          <IdentityFields form={form} lookups={lookups} editing={editing} taken={taken} onCheckTag={checkTag} onTagChange={() => setTaken(null)} onNewModel={() => router.push("/assets/models/new")} />
          <ConditionFields form={form} lookups={lookups} onNewLocation={() => setDialog("location")} />
          <SheetMore defaultOpen={editing} label="Purchase and more details">
            <PurchaseFields form={form} lookups={lookups} initial={values} supplierId={supplierId} onOpen={setDialog} />
          </SheetMore>
        </div>
      </FormSheet>

      <QuickCreateLocation open={dialog === "location"} onOpenChange={closeDialog} onCreated={(id) => form.setValue("locationId", id, { shouldDirty: true })} />
      <QuickCreateSupplier open={dialog === "supplier"} onOpenChange={closeDialog} onCreated={(id) => form.setValue("supplierId", id, { shouldDirty: true })} />
      {supplierId ? (
        <QuickCreateSupplierOrder
          open={dialog === "order"}
          onOpenChange={closeDialog}
          supplierId={supplierId}
          onCreated={(o) => { form.setValue("supplierOrderId", o.id, { shouldDirty: true }); form.setValue("purchaseOrderNumber", o.orderNumber); }}
        />
      ) : null}
    </>
  );
}

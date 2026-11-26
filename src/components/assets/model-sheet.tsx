"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { modelSchema, type ModelFormValues } from "@/lib/validations/model";
import { useActiveOrganization } from "@/lib/auth-client";
import { useModelWrites } from "@/hooks/use-model-writes";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useCategoriesWithParent } from "@/hooks/use-categories";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { useActiveMilestoneKey } from "@/hooks/use-activation-milestones";
import { FormSheet } from "@/components/ui/form-sheet";
import { SheetMore } from "@/components/ui/sheet-parts";
import { QuickCreateCategory } from "./quick-create-category";
import { ModelComplianceFields, ModelIdentityFields, ModelMoreFields, ModelPricingFields, ModelXeroFields, type ProfileOption } from "./model-sheet-fields";

/**
 * `ModelSheet` (UX Phase 12, D62/D63): the ONE create and edit surface for equipment
 * models, on `FormSheet`. It replaces `model-form` and the `/assets/models/new` and
 * `[id]/edit` pages (which redirect to `ModelSheetHost`). Edit opens with every stored
 * field (`modelToFormValues`), so saving never clears rates the form did not show.
 */
const CREATE_DEFAULTS: ModelFormValues = {
  name: "", manufacturer: "", modelNumber: "", sku: "", categoryId: "", description: "",
  assetType: "SERIALIZED", requiresTestAndTag: false, isActive: true, images: [], manuals: [],
};

interface ModelSheetProps {
  mode: "create" | "edit";
  /** Edit: the record's values. Create: omit. */
  values?: ModelFormValues & { id: string };
  /** Edit only: live stock under the model, which locks the asset type directions that would orphan it. */
  stock?: { assets: number; bulk: number };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
}

/** The ONE save: update or create, the toast (with the first-model hand-off), then close. */
function useModelSheetSave({ form, editId, orgId, onClose, onSaved }: {
  form: UseFormReturn<ModelFormValues>; editId?: string; orgId?: string; onClose: () => void; onSaved?: (r: { id: string }) => void;
}) {
  const router = useRouter();
  const writes = useModelWrites();
  // The one creation that completes the org's active "model" milestone gets the hand-off.
  const isModelMilestone = useActiveMilestoneKey(orgId) === "model";
  const [saving, setSaving] = useState(false);

  const submit = form.handleSubmit(async (data) => {
    setSaving(true);
    try {
      const r = editId ? await writes.update(editId, data) : await writes.create(data);
      const handOff = !editId && isModelMilestone ? { action: { label: "Add an asset", onClick: () => router.push(`/assets/registry/new?modelId=${r.id}`) } } : undefined;
      toast.success(editId ? "Model updated" : "Model created", handOff);
      onClose();
      onSaved?.(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the model");
    } finally {
      setSaving(false);
    }
  });
  return { saving, submit };
}

export function ModelSheet({ mode, values, stock, onClose, onSaved }: ModelSheetProps) {
  const editing = mode === "edit";
  const orgId = useActiveOrganization().data?.id;
  const categories = useCategoriesWithParent(orgId) ?? [];
  const orgTags = useOrgTags(orgId);
  const xeroLinked = useXeroLinked();
  const profiles = ((useTestProfiles(orgId) ?? []) as unknown as (ProfileOption & { isActive?: boolean })[]).filter((p) => p.isActive);
  const form = useForm<ModelFormValues>({ resolver: zodResolver(modelSchema), mode: "onTouched", defaultValues: values ?? CREATE_DEFAULTS });
  const [newCategory, setNewCategory] = useState(false);
  const { saving, submit } = useModelSheetSave({ form, editId: editing ? values?.id : undefined, orgId, onClose, onSaved });

  return (
    <>
      <FormSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={editing ? `Edit ${values?.name || "model"}` : "New model"}
        description={editing ? undefined : "The spec sheet, not a physical unit. The gear hangs off it later."}
        primaryLabel={editing ? "Save" : "Create model"}
        onSubmit={submit}
        submitting={saving}
        dirty={form.formState.isDirty}
      >
        <div className="space-y-6">
          <ModelIdentityFields form={form} categories={categories} onNewCategory={() => setNewCategory(true)} lock={{ bulk: stock?.assets ?? 0, serialised: stock?.bulk ?? 0 }} />
          <ModelPricingFields form={form} />
          {xeroLinked ? <ModelXeroFields form={form} /> : null}
          <ModelComplianceFields form={form} profiles={profiles} categories={categories} />
          <SheetMore defaultOpen={editing} label="More details"><ModelMoreFields form={form} orgTags={orgTags} editing={editing} /></SheetMore>
        </div>
      </FormSheet>
      <QuickCreateCategory open={newCategory} onOpenChange={setNewCategory} onCreated={(id) => form.setValue("categoryId", id, { shouldDirty: true })} />
    </>
  );
}

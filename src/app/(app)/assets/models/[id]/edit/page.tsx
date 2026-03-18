"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getModel } from "@/server/models";
import { ModelForm } from "@/components/assets/model-form";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ModelFormValues } from "@/lib/validations/model";

export default function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: model, isLoading } = useQuery({
    queryKey: ["model", orgId, id],
    queryFn: () => getModel(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!model) return <div className="text-muted-foreground">Model not found.</div>;

  const initialData: ModelFormValues & { id: string } = {
    id: model.id,
    name: model.name,
    manufacturer: model.manufacturer || "",
    modelNumber: model.modelNumber || "",
    sku: model.sku || "",
    categoryId: model.categoryId || "",
    description: model.description || "",
    image: model.image || "",
    images: model.images,
    manuals: model.manuals,
    specifications: (model.specifications as Record<string, string>) || {},
    customFields: (model.customFields as Record<string, string>) || {},
    defaultRentalPrice: model.defaultRentalPrice ? Number(model.defaultRentalPrice) : undefined,
    defaultPurchasePrice: model.defaultPurchasePrice ? Number(model.defaultPurchasePrice) : undefined,
    replacementCost: model.replacementCost ? Number(model.replacementCost) : undefined,
    weight: model.weight ? Number(model.weight) : undefined,
    powerDraw: model.powerDraw || undefined,
    requiresTestAndTag: model.requiresTestAndTag,
    testAndTagIntervalDays: model.testAndTagIntervalDays || undefined,
    defaultEquipmentClass: model.defaultEquipmentClass || undefined,
    defaultApplianceType: model.defaultApplianceType || undefined,
    maintenanceIntervalDays: model.maintenanceIntervalDays || undefined,
    assetType: model.assetType,
    barcodeLabelTemplate: model.barcodeLabelTemplate || "",
    isActive: model.isActive,
    tags: model.tags ?? [],
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Model</h1>
        <p className="text-muted-foreground">{model.name}</p>
      </div>
      <ModelForm initialData={initialData} />
    </div>
  );
}

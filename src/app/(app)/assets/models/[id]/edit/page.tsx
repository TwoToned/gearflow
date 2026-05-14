"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getModel } from "@/server/models";
import { ModelForm } from "@/components/assets/model-form";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import type { ModelFormValues } from "@/lib/validations/model";

export default function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: model, isLoading } = useQuery({
    queryKey: ["model", orgId, id],
    queryFn: () => getModel(id),
  });

  if (isLoading) return <div className="t-body text-fg-3">Loading...</div>;
  if (!model) return <div className="t-body text-fg-3">Model not found.</div>;

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
    defaultTestProfileId: model.defaultTestProfileId || undefined,
    defaultEquipmentClass: model.defaultEquipmentClass || undefined,
    defaultApplianceType: model.defaultApplianceType || undefined,
    maintenanceIntervalDays: model.maintenanceIntervalDays || undefined,
    assetType: model.assetType,
    barcodeLabelTemplate: model.barcodeLabelTemplate || "",
    isActive: model.isActive,
    tags: model.tags ?? [],
  };

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/assets" className="hover:text-fg transition-colors">Assets</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/assets/models" className="hover:text-fg transition-colors">Models</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/assets/models/${id}`} className="hover:text-fg transition-colors">{model.name}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">Edit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">Edit Model</h1>
          <p className="t-body text-fg-3">{model.name}</p>
        </div>
        <ModelForm initialData={initialData} />
      </div>
    </FadeIn>
  );
}

"use client";

import { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getModel } from "@/server/models";
import { ModelForm } from "@/components/assets/model-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import type { ModelFormValues } from "@/lib/validations/model";

export default function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="model" action="update">
      <EditModelContent params={params} />
    </RequirePermission>
  );
}

function EditModelContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: model, isLoading } = useServerQuery({
    queryKey: ["model", orgId, id],
    queryFn: () => getModel(id),
  });

  if (isLoading) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!model) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Model not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      </div>
    );
  }

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
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/assets/models" />}>Models</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/assets/models/${id}`} />}>{model.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">Edit model</h1>
          <p className="mt-1 text-ui-text text-muted">{model.name}</p>
        </div>
        <ModelForm initialData={initialData} />
      </div>
    </FadeIn>
  );
}

"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

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
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../../../convex/_generated/api";
import { ModelForm } from "@/components/assets/model-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
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

  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: model, isLoading } = useServerQuery({
    queryKey: ["model", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.models.detail, { id }),
    enabled: !!orgId && isAuthenticated,
  });

  if (isLoading) return <FadeIn><div className="mx-auto max-w-5xl"><FormSkeleton /></div></FadeIn>;
  if (!model) {
    return (
      <div className="mx-auto max-w-5xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
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
    // maintenanceIntervalDays intentionally omitted — superseded by
    // serviceSchedules (WS6 #945), removed from modelSchema/the form.
    assetType: model.assetType,
    barcodeLabelTemplate: model.barcodeLabelTemplate || "",
    isActive: model.isActive,
    tags: model.tags ?? [],
    xeroRentalAccountCode: model.xeroRentalAccountCode || undefined,
    xeroSaleAccountCode: model.xeroSaleAccountCode || undefined,
  };

  return (
    <FadeIn>
      <div className="mx-auto max-w-5xl space-y-4">
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
        <PageHeader title="Edit model" description={model.name} />
        <ModelForm initialData={initialData} />
      </div>
    </FadeIn>
  );
}

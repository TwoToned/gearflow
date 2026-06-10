"use client";

import { use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getAsset } from "@/server/assets";
import { getBulkAsset } from "@/server/bulk-assets";
import { useActiveOrganization } from "@/lib/auth-client";
import { AssetForm } from "@/components/assets/asset-form";
import { BulkAssetForm } from "@/components/assets/bulk-asset-form";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { AssetFormValues } from "@/lib/validations/asset";
import type { BulkAssetFormValues } from "@/lib/validations/asset";

export default function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>}>
      <EditAssetContent params={params} />
    </Suspense>
  );
}

function EditAssetContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isBulk = searchParams.get("type") === "bulk";
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const assetQuery = useQuery({
    queryKey: ["asset", orgId, id],
    queryFn: () => getAsset(id),
    enabled: !isBulk,
  });

  const bulkQuery = useQuery({
    queryKey: ["bulk-asset", orgId, id],
    queryFn: () => getBulkAsset(id),
    enabled: isBulk,
  });

  const isLoading = isBulk ? bulkQuery.isLoading : assetQuery.isLoading;
  if (isLoading) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;

  if (isBulk) {
    const ba = bulkQuery.data;
    if (!ba) return <div className="t-body text-fg-3">Bulk asset not found.</div>;

    const initialData: BulkAssetFormValues & { id: string } = {
      id: ba.id,
      modelId: ba.modelId,
      assetTag: ba.assetTag,
      totalQuantity: ba.totalQuantity,
      purchasePricePerUnit: ba.purchasePricePerUnit ? Number(ba.purchasePricePerUnit) : undefined,
      locationId: ba.locationId || "",
      status: ba.status as BulkAssetFormValues["status"],
      reorderThreshold: ba.reorderThreshold ?? undefined,
      notes: ba.notes || "",
      isActive: ba.isActive,
      tags: ba.tags ?? [],
    };

    return (
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/assets/registry" />}>Assets</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={`/assets/registry/${id}?type=bulk`} />}>{ba.assetTag}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Edit</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div>
            <h1 className="t-title text-fg">Edit Bulk Asset</h1>
            <p className="t-body text-fg-3 font-mono">{ba.assetTag}</p>
          </div>
          <BulkAssetForm initialData={initialData} />
        </div>
      </FadeIn>
    );
  }

  const asset = assetQuery.data;
  if (!asset) return <div className="t-body text-fg-3">Asset not found.</div>;

  const formatDateForInput = (date: Date | string | null | undefined) => {
    if (!date) return undefined;
    const d = new Date(date);
    return d;
  };

  const initialData: AssetFormValues & { id: string } = {
    id: asset.id,
    modelId: asset.modelId,
    assetTag: asset.assetTag,
    serialNumber: asset.serialNumber || "",
    customName: asset.customName || "",
    status: asset.status as AssetFormValues["status"],
    condition: asset.condition as AssetFormValues["condition"],
    purchaseDate: formatDateForInput(asset.purchaseDate),
    purchasePrice: asset.purchasePrice ? Number(asset.purchasePrice) : undefined,
    purchaseSupplier: asset.purchaseSupplier || "",
    supplierId: asset.supplierId || "",
    warrantyExpiry: formatDateForInput(asset.warrantyExpiry),
    notes: asset.notes || "",
    locationId: asset.locationId || "",
    barcode: asset.barcode || "",
    images: asset.images || [],
    isActive: asset.isActive,
    tags: asset.tags ?? [],
  };

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/assets/registry" />}>Assets</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/assets/registry/${asset.id}`} />}>{asset.assetTag}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="t-title text-fg">Edit Asset</h1>
          <p className="t-body text-fg-3 font-mono">{asset.assetTag}</p>
        </div>
        <AssetForm initialData={initialData} />
      </div>
    </FadeIn>
  );
}

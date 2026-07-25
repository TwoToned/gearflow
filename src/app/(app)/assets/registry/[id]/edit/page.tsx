"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAsset, useBulkAsset } from "@/hooks/use-assets";
import { AssetForm } from "@/components/assets/asset-form";
import { BulkAssetForm } from "@/components/assets/bulk-asset-form";
import { EditLockGate } from "@/components/collaboration/edit-lock-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
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
    <RequirePermission resource="asset" action="update">
      <Suspense fallback={<FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>}>
        <EditAssetContent params={params} />
      </Suspense>
    </RequirePermission>
  );
}

function EditAssetContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isBulk = searchParams.get("type") === "bulk";

  // Reactive asset/bulk straight from Convex — the edit forms only need scalar
  // fields (no cross-domain composition), so a pure useQuery subscription suffices.
  const asset = useAsset(isBulk ? undefined : id);
  const ba = useBulkAsset(isBulk ? id : undefined);

  const isLoading = isBulk ? ba === undefined : asset === undefined;
  if (isLoading) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;

  if (isBulk) {
    if (!ba) {
      return (
        <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Bulk asset not found.</p>
          <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        </div>
      );
    }

    const initialData: BulkAssetFormValues & { id: string } = {
      id: ba.id,
      modelId: ba.modelId,
      assetTag: ba.assetTag,
      totalQuantity: ba.totalQuantity,
      purchasePricePerUnit: ba.purchasePricePerUnit ? Number(ba.purchasePricePerUnit) : undefined,
      locationId: ba.locationId || "",
      status: ba.status as BulkAssetFormValues["status"],
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
          <PageHeader title="Edit bulk asset" description={ba.assetTag} />
          <EditLockGate entityType="asset" entityId={id}>
            <BulkAssetForm initialData={initialData} />
          </EditLockGate>
        </div>
      </FadeIn>
    );
  }

  if (!asset) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Asset not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      </div>
    );
  }

  const formatDateForInput = (date: Date | string | number | null | undefined) => {
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
      <div className="mx-auto max-w-5xl space-y-4">
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
        <PageHeader title="Edit asset" description={asset.assetTag} />
        <EditLockGate entityType="asset" entityId={id}>
          <AssetForm initialData={initialData} />
        </EditLockGate>
      </div>
    </FadeIn>
  );
}

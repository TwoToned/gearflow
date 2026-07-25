"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AssetForm } from "@/components/assets/asset-form";
import { BulkAssetForm } from "@/components/assets/bulk-asset-form";
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

function NewAssetContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "serialized";
  const modelId = searchParams.get("modelId") || undefined;

  const title = type === "bulk" ? "New bulk asset" : "New asset";
  const isBulk = type === "bulk";

  return (
    <FadeIn>
      <div className={`mx-auto space-y-4 ${isBulk ? "max-w-3xl" : "max-w-5xl"}`}>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/assets/registry" />}>Assets</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader
          title={title}
          description={
            type === "bulk"
              ? "Create a bulk stock entry tracked by quantity."
              : "Create a serialised asset tracked individually."
          }
        />
        {type === "bulk" ? (
          <BulkAssetForm preselectedModelId={modelId} />
        ) : (
          <AssetForm preselectedModelId={modelId} />
        )}
      </div>
    </FadeIn>
  );
}

export default function NewAssetPage() {
  return (
    <RequirePermission resource="asset" action="create">
      <Suspense fallback={<FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>}>
        <NewAssetContent />
      </Suspense>
    </RequirePermission>
  );
}

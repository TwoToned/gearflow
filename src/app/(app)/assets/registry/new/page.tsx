"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AssetForm } from "@/components/assets/asset-form";
import { BulkAssetForm } from "@/components/assets/bulk-asset-form";
import { FadeIn } from "@/components/ui/motion";
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

  const title = type === "bulk" ? "New Bulk Asset" : "New Asset";

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
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="t-title text-fg">{title}</h1>
          <p className="t-body text-fg-3">
            {type === "bulk"
              ? "Create a bulk stock entry tracked by quantity."
              : "Create a serialized asset tracked individually."}
          </p>
        </div>
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
    <Suspense fallback={<div className="t-body text-fg-3">Loading...</div>}>
      <NewAssetContent />
    </Suspense>
  );
}

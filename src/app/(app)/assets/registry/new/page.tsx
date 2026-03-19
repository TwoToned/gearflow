"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AssetForm } from "@/components/assets/asset-form";
import { BulkAssetForm } from "@/components/assets/bulk-asset-form";

function NewAssetContent() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "serialized";
  const modelId = searchParams.get("modelId") || undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">
          {type === "bulk" ? "New Bulk Asset" : "New Asset"}
        </h1>
        <p className="text-[13px] text-fg-3">
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
  );
}

export default function NewAssetPage() {
  return (
    <Suspense fallback={<div className="text-[13px] text-fg-3">Loading...</div>}>
      <NewAssetContent />
    </Suspense>
  );
}

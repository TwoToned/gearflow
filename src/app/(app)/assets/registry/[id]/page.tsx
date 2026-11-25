"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConvex, useConvexAuth } from "convex/react";

import { AssetDetail } from "@/components/assets/detail/asset-detail";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useServerQuery } from "@/hooks/use-server-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../../../../convex/_generated/api";

/**
 * `/assets/registry/[id]` (UX Phase 12, §9d): a serialised unit's page. Bulk stock has no
 * page of its own, it lives on its model's page, so `?type=bulk` forwards there. The
 * page itself is `AssetDetail`; this file only picks which to render.
 */
export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="asset" action="read">
      <Suspense fallback={<DetailPageSkeleton />}>
        <AssetRoute params={params} />
      </Suspense>
    </RequirePermission>
  );
}

function AssetRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isBulk = useSearchParams().get("type") === "bulk";
  return isBulk ? <BulkForward id={id} /> : <AssetDetail id={id} />;
}

function BulkForward({ id }: { id: string }) {
  const router = useRouter();
  const wantsEdit = useSearchParams().get("edit") === "1";
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: bulk, isLoading } = useServerQuery({
    queryKey: ["bulk-asset", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.bulkAssets.detail, { id, orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });
  const modelId = bulk?.modelId;
  useEffect(() => {
    // The model page hosts bulk stock; `edit-asset` opens its edit sheet there.
    if (modelId) router.replace(`/assets/models/${modelId}?tab=assets${wantsEdit ? `&edit-asset=${id}` : ""}`);
  }, [modelId, router, wantsEdit, id]);

  if (isLoading || modelId) return <DetailPageSkeleton />;
  return (
    <div className="py-16 text-center">
      <p className="text-ui-text text-ink-2">Bulk asset not found.</p>
      <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      <Button variant="line" size="sm" className="mt-4" asChild><Link href="/assets/registry">Back to assets</Link></Button>
    </div>
  );
}

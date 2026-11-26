"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use } from "react";
import Link from "next/link";

import { RequirePermission } from "@/components/auth/require-permission";
import { CategoryRecord } from "@/components/assets/category/category-record";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../../../../convex/_generated/api";

/**
 * The gear Category record (UX Phase 14, 14b-5): the page owns the permission gate and the loading / not-found states;
 * `CategoryRecord` is the section 4.2 record (header word, Overview, Models, Kits, Subcategories, History, the Edit sheet).
 */
export default function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="model" action="read">
      <CategoryDetailContent params={params} />
    </RequirePermission>
  );
}

function CategoryDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  // `getById` answers null for a missing category (the detail composite throws), so the not-found state is a plain branch.
  const category = useAuthedQuery(api.categories.getById, orgId ? { id } : "skip");

  if (category === undefined) return <DetailPageSkeleton />;
  if (!category) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Category not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/assets/categories">Back to categories</Link>
        </Button>
      </div>
    );
  }
  return <CategoryRecord id={id} orgId={orgId} />;
}

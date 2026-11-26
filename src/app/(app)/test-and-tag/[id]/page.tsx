"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use } from "react";
import Link from "next/link";

import { RequirePermission } from "@/components/auth/require-permission";
import { TestTagRecord } from "@/components/test-tag/record/test-tag-record";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../../../convex/_generated/api";

/**
 * The Test & tag record (UX Phase 14, 14b-4): the page owns the permission gate and the loading / not-found states;
 * `TestTagRecord` is the §4.2 record (header word, Overview checks, Tests, History, the real Edit sheet).
 */
export default function TestTagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="testTag" action="read">
      <TestTagDetailContent params={params} />
    </RequirePermission>
  );
}

function TestTagDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const item = useAuthedQuery(api.testTagAssets.detail, orgId ? { orgId, id } : "skip");

  if (item === undefined) return <DetailPageSkeleton />;
  if (!item) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Item not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/test-and-tag">Back to test &amp; tag</Link>
        </Button>
      </div>
    );
  }
  return <TestTagRecord id={id} orgId={orgId} />;
}

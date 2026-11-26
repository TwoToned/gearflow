"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use } from "react";
import Link from "next/link";

import { RequirePermission } from "@/components/auth/require-permission";
import { MaintenanceRecord } from "@/components/maintenance/record/maintenance-record";
import { Button } from "@/components/ui/button";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../../../convex/_generated/api";

/**
 * The maintenance record (UX Phase 14, 14b-3): the page owns the permission gate and the loading / not-found states;
 * `MaintenanceRecord` is the §4.2 record (header word, Overview checks, Assets, Parts, History, Files).
 */
export default function MaintenanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="maintenance" action="read">
      <MaintenanceDetailContent params={params} />
    </RequirePermission>
  );
}

function MaintenanceDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const record = useAuthedQuery(api.maintenanceRecords.recordDetail, orgId ? { orgId, id } : "skip");

  if (record === undefined) return <DetailPageSkeleton />;
  if (!record) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Job not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/maintenance">Back to maintenance</Link>
        </Button>
      </div>
    );
  }
  return <MaintenanceRecord id={id} orgId={orgId} />;
}

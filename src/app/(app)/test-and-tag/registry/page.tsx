"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestTagTable } from "@/components/test-tag/test-tag-table";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function TestTagRegistryPage() {
  // Bumped after a sync to refetch the co-mounted TestTagTable (its sole
  // reader). The cross-route test-tag-dashboard-stats reader (the dashboard
  // landing) is on useServerQuery and remounts on navigation — no invalidate.
  const [refreshSignal, setRefreshSignal] = useState(0);

  const backfillMutation = useServerMutation({
    mutationFn: () => backfillTestTagAssets(),
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.created > 0) parts.push(`registered ${result.created}`);
      if (result.retired > 0) parts.push(`retired ${result.retired}`);
      if (parts.length > 0) {
        toast.success(`Sync complete: ${parts.join(", ")} item${(result.created + result.retired) === 1 ? "" : "s"}`);
        setRefreshSignal((n) => n + 1);
      } else {
        toast.info("Everything is in sync");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission resource="testTag" action="read">
    <FadeIn>
    <div className="space-y-4">
      <PageHeader
        title="Test & tag registry"
        description="View and manage all test and tag assets."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="line"
              size="sm"
              onClick={() => backfillMutation.mutate()}
              loading={backfillMutation.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync
            </Button>
            <Button size="sm" asChild>
              <Link href="/test-and-tag/new">
                <Plus className="mr-2 h-4 w-4" />
                Add item
              </Link>
            </Button>
          </div>
        }
      />
      <TestTagTable refreshSignal={refreshSignal} />
    </div>
    </FadeIn>
    </RequirePermission>
  );
}

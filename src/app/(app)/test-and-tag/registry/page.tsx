"use client";

import Link from "next/link";
import { Plus, Loader2, RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TestTagTable } from "@/components/test-tag/test-tag-table";
import { backfillTestTagAssets } from "@/server/test-tag-assets";
import { RequirePermission } from "@/components/auth/require-permission";

export default function TestTagRegistryPage() {
  const queryClient = useQueryClient();

  const backfillMutation = useMutation({
    mutationFn: () => backfillTestTagAssets(),
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.created > 0) parts.push(`registered ${result.created}`);
      if (result.retired > 0) parts.push(`retired ${result.retired}`);
      if (parts.length > 0) {
        toast.success(`Sync complete: ${parts.join(", ")} item${(result.created + result.retired) === 1 ? "" : "s"}`);
        queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
        queryClient.invalidateQueries({ queryKey: ["test-tag-dashboard-stats"] });
      } else {
        toast.info("Everything is in sync");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <RequirePermission resource="testTag" action="read">
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="t-title text-fg">Test & Tag Registry</h1>
          <p className="text-fg-3 text-sm">
            View and manage all test and tag assets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
          >
            {backfillMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync
          </Button>
          <Button size="sm" render={<Link href="/test-and-tag/new" />}>
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>
      <TestTagTable />
    </div>
    </RequirePermission>
  );
}

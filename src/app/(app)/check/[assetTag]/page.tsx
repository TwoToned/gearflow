"use client";

import { use, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ScanBarcode,
  Loader2,
  AlertTriangle,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { lookupAssetForAdHocCheck, saveAdHocCheck } from "@/server/check-records";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { ItemCheckForm } from "@/components/warehouse/item-check-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageMeta } from "@/components/layout/page-meta";

export default function AdHocCheckPage({
  params,
}: {
  params: Promise<{ assetTag: string }>;
}) {
  const { assetTag: urlTag } = use(params);
  const decodedTag = decodeURIComponent(urlTag);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const router = useRouter();

  const [completed, setCompleted] = useState(false);

  const { data: result, isLoading } = useQuery({
    queryKey: ["ad-hoc-lookup", orgId, decodedTag],
    queryFn: () => lookupAssetForAdHocCheck(decodedTag),
  });

  const lookup = result as {
    found: boolean;
    asset: {
      id: string;
      assetTag: string;
      serialNumber: string | null;
      modelId: string;
      modelName: string;
      checkItemCount: number;
    } | null;
  } | undefined;

  const submitMutation = useMutation({
    mutationFn: (checks: Array<{
      checkItemId: string;
      result: "PASS" | "FAIL" | "NOTES_ONLY";
      value?: string;
      notes?: string;
      photos?: string[];
    }>) =>
      saveAdHocCheck({
        assetId: lookup!.asset!.id,
        context: "AD_HOC",
        checks,
      }),
    onSuccess: () => {
      setCompleted(true);
      toast.success("Ad-hoc check saved");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <RequirePermission resource="warehouse" action="scan">
      <PageMeta title="Ad-Hoc Check" />
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="t-title text-fg">Ad-Hoc Check</h1>
          <p className="text-sm text-fg-3 mt-1">
            Perform a quality check on an asset outside of a project.
          </p>
        </div>

        {/* Scanner for navigating to different tags */}
        <ScanNavInput currentTag={decodedTag} />

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-fg-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Looking up asset...
          </div>
        ) : !lookup?.found ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-fg-3">
            <AlertTriangle className="mb-2 h-8 w-8 opacity-50" />
            <p className="font-medium">Asset not found</p>
            <p className="mt-1 text-xs">
              No asset with tag <span className="font-mono">{decodedTag}</span> was found in your organization.
            </p>
          </div>
        ) : lookup.asset!.checkItemCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-fg-3">
            <ClipboardCheck className="mb-2 h-8 w-8 opacity-50" />
            <p className="font-medium">No check items assigned</p>
            <p className="mt-1 text-xs">
              The model <span className="font-medium">{lookup.asset!.modelName}</span> has no check items.{" "}
              <Link href="/settings/check-items" className="text-primary hover:underline">
                Add check items
              </Link>{" "}
              to enable quality checks.
            </p>
          </div>
        ) : completed ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-green-500/30 bg-green-500/5 py-12">
            <CheckCircle2 className="mb-2 h-8 w-8 text-green-500" />
            <p className="font-medium text-green-500">Check Complete</p>
            <p className="mt-1 text-xs text-fg-3">
              Results saved for {lookup.asset!.modelName} ({lookup.asset!.assetTag})
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompleted(false)}
              >
                Check Again
              </Button>
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/assets/registry/${lookup.asset!.id}`} />}
              >
                View Asset
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-medium">{lookup.asset!.modelName}</p>
              <p className="text-xs text-fg-3">
                {lookup.asset!.assetTag}
                {lookup.asset!.serialNumber && ` · S/N: ${lookup.asset!.serialNumber}`}
              </p>
            </div>
            <ItemCheckForm
              open={true}
              onOpenChange={() => {}}
              modelId={lookup.asset!.modelId}
              assetTag={lookup.asset!.assetTag}
              assetName={lookup.asset!.modelName}
              context="AD_HOC"
              onSubmit={(checks) => submitMutation.mutate(checks)}
              onCancel={() => router.back()}
              isSubmitting={submitMutation.isPending}
              embedded
            />
          </div>
        )}
      </div>
    </RequirePermission>
  );
}

// ─── Scan Input for navigating to other asset tags ──────────────────────────

function ScanNavInput({ currentTag }: { currentTag: string }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tag = value.trim();
    if (tag && tag !== currentTag) {
      router.push(`/check/${encodeURIComponent(tag)}`);
      setValue("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative max-w-md">
      <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Scan another asset tag..."
        className="pl-10 text-sm"
      />
    </form>
  );
}

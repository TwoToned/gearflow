"use client";

import { use, useState, useRef } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  ScanBarcode,
  AlertTriangle,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { lookupAssetForAdHocCheck } from "@/server/check-records";
import { useCheckRecordWrites } from "@/hooks/use-check-record-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { focusRing } from "@/lib/utils";
import { RequirePermission } from "@/components/auth/require-permission";
import { ItemCheckForm } from "@/components/warehouse/item-check-form";

import { Button } from "@/components/ui/button";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Skeleton } from "@/components/ui/skeleton";
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
  const checkRecordWrites = useCheckRecordWrites();

  const { data: result, isLoading } = useServerQuery({
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

  const submitMutation = useServerMutation({
    mutationFn: (checks: Array<{
      checkItemId: string;
      result: "PASS" | "FAIL" | "NOTES_ONLY";
      value?: string;
      notes?: string;
      photos?: string[];
    }>) =>
      checkRecordWrites.saveAdHocCheck({
        assetId: lookup!.asset!.id,
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
          <h1 className="t-title text-ink">Ad-hoc check</h1>
          <p className="text-ui-text text-muted mt-1">
            Perform a quality check on an asset outside of a project.
          </p>
        </div>

        {/* Scanner for navigating to different tags */}
        <ScanNavInput currentTag={decodedTag} />

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 rounded-[var(--r)]" />
            <Skeleton className="h-40 rounded-[var(--r-lg)]" />
          </div>
        ) : !lookup?.found ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--r-lg)] border-2 border-dashed border-line py-12 text-muted">
            <AlertTriangle className="mb-2 h-8 w-8 text-faint" />
            <p className="font-medium text-ink">Asset not found</p>
            <p className="mt-1 text-caption">
              No asset with tag <span className="font-mono">{decodedTag}</span> was found in your organization.
            </p>
          </div>
        ) : lookup.asset!.checkItemCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--r-lg)] border-2 border-dashed border-line py-12 text-muted">
            <ClipboardCheck className="mb-2 h-8 w-8 text-faint" />
            <p className="font-medium text-ink">No check items assigned</p>
            <p className="mt-1 text-caption text-center px-4">
              The model <span className="font-medium text-ink-2">{lookup.asset!.modelName}</span> has no check items.{" "}
              <Link href="/settings/check-items" className={`text-link hover:underline rounded-[var(--r)] ${focusRing}`}>
                Add check items
              </Link>{" "}
              to enable quality checks.
            </p>
          </div>
        ) : completed ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--r-lg)] border-l-[3px] border-l-ok bg-ok-soft/50 ring-1 ring-line py-12">
            <CheckCircle2 className="mb-2 h-8 w-8 text-ok" />
            <p className="font-medium text-ok">Check complete</p>
            <p className="mt-1 text-caption text-muted">
              Results saved for {lookup.asset!.modelName} ({lookup.asset!.assetTag})
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="line"
                size="sm"
                onClick={() => setCompleted(false)}
              >
                Check again
              </Button>
              <Button
                variant="line"
                size="sm"
                asChild
              >
                <Link href={`/assets/registry/${lookup.asset!.id}`}>
                  View asset
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-[var(--r-lg)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <p className="text-ui-text font-medium text-ink">{lookup.asset!.modelName}</p>
              <p className="text-caption text-muted">
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

  function go(tag: string) {
    const trimmed = tag.trim();
    if (trimmed && trimmed !== currentTag) {
      router.push(`/check/${encodeURIComponent(trimmed)}`);
      setValue("");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    go(value);
  }

  // Plain tag input. The leading ScanBarcode icon is preserved as a typed-input
  // affordance; submitting (Enter / form submit) routes the typed tag to `go`.
  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 h-4 w-4 text-muted" />
        <AssetTagInput
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Scan another asset tag..."
          className="pl-10"
        />
      </div>
    </form>
  );
}

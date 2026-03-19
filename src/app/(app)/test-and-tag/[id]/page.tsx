"use client";

import { use, Suspense } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Zap,
  Pencil,
  ArchiveX,
  Trash2,
  ChevronRight,
  MapPin,
  CalendarClock,
  Wrench,
  Link2,
  Clock,
} from "lucide-react";

import { getTestTagAsset, retireTestTagAsset, deleteTestTagAsset } from "@/server/test-tag-assets";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { PageMeta } from "@/components/layout/page-meta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import type { ColorIntent } from "@/lib/status-colors";

// ─── Helpers ──────────────────────────────────────────────────────

const statusIntentMap: Record<string, ColorIntent> = {
  CURRENT: "success",
  DUE_SOON: "warning",
  OVERDUE: "error",
  FAILED: "error",
  NOT_YET_TESTED: "neutral",
  RETIRED: "neutral",
};

const statusLabelMap: Record<string, string> = {
  CURRENT: "Current",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  FAILED: "Failed",
  NOT_YET_TESTED: "Not Tested",
  RETIRED: "Retired",
};

const equipmentClassLabels: Record<string, string> = {
  CLASS_I: "Class I",
  CLASS_II: "Class II",
  CLASS_II_DOUBLE_INSULATED: "Class II (Double Insulated)",
  LEAD_CORD_ASSEMBLY: "Lead / Cord Assembly",
};

const applianceTypeLabels: Record<string, string> = {
  APPLIANCE: "Appliance",
  CORD_SET: "Cord Set",
  EXTENSION_LEAD: "Extension Lead",
  POWER_BOARD: "Power Board",
  RCD_PORTABLE: "RCD (Portable)",
  RCD_FIXED: "RCD (Fixed)",
  THREE_PHASE: "Three Phase",
  OTHER: "Other",
};

function formatDate(date: Date | string | null | undefined) {
  if (!date) return "\u2014";
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function resultBadge(result: string) {
  if (result === "PASS")
    return (
      <StatusIndicator intent="success" label="Pass" variant="pill" />
    );
  if (result === "FAIL")
    return (
      <StatusIndicator intent="error" label="Fail" variant="pill" />
    );
  if (result === "NOT_APPLICABLE")
    return <span className="text-fg-3 text-xs">N/A</span>;
  return <span className="text-fg-3 text-xs">{result}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────

export default function TestTagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="testTag" action="read">
      <Suspense fallback={<DetailPageSkeleton />}>
        <TestTagDetailContent params={params} />
      </Suspense>
    </RequirePermission>
  );
}

function TestTagDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: item, isLoading, error } = useQuery({
    queryKey: ["test-tag-asset", orgId, id],
    queryFn: () => getTestTagAsset(id),
  });

  const retireMutation = useMutation({
    mutationFn: () => retireTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset retired");
      queryClient.invalidateQueries({ queryKey: ["test-tag-asset"] });
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset deleted");
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
      router.push("/test-and-tag/registry");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <DetailPageSkeleton />;

  if (error || !item) {
    return (
      <div className="py-20 text-center text-fg-3">
        {error ? error.message : "Test tag asset not found"}
      </div>
    );
  }

  const latestRecord = item.testRecords[0] ?? null;

  return (
    <FadeIn>
      <PageMeta title={`${item.testTagId} — Test & Tag`} />
      <div className="space-y-6">
        {/* ── Header (full width) ────────────────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
            <Link href="/test-and-tag" className="hover:text-fg transition-colors">
              Test & Tag
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/test-and-tag/registry" className="hover:text-fg transition-colors">
              Registry
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-mono text-fg-2">{item.testTagId}</span>
          </nav>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title text-fg">{item.testTagId}</h1>
                <StatusIndicator
                  intent={statusIntentMap[item.status] || "neutral"}
                  label={statusLabelMap[item.status] || item.status}
                />
                {latestRecord && (
                  <StatusIndicator
                    intent={latestRecord.result === "PASS" ? "success" : latestRecord.result === "FAIL" ? "error" : "neutral"}
                    label={`Last: ${latestRecord.result === "PASS" ? "Pass" : latestRecord.result === "FAIL" ? "Fail" : latestRecord.result}`}
                  />
                )}
              </div>
              <p className="text-fg-3 mt-0.5">
                {item.description}
                {item.make && <> &middot; {item.make}</>}
                {item.modelName && <> {item.modelName}</>}
              </p>
            </div>

            <CanDo resource="testTag" action="update">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  render={<Link href={`/test-and-tag/quick-test?id=${item.testTagId}`} />}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  Record Test
                </Button>
                <Button variant="outline" size="sm" disabled>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {item.status !== "RETIRED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm("Are you sure you want to retire this test tag asset?")) {
                        retireMutation.mutate();
                      }
                    }}
                    disabled={retireMutation.isPending}
                  >
                    <ArchiveX className="mr-2 h-4 w-4" />
                    {retireMutation.isPending ? "Retiring..." : "Retire"}
                  </Button>
                )}
                {item.status === "RETIRED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm("Permanently delete this test tag asset and all its test records? This cannot be undone.")) {
                        deleteMutation.mutate();
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </Button>
                )}
              </div>
            </CanDo>
          </div>
        </div>

        {/* ── 2-Column Layout ────────────────────────────────────── */}
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ── Main content (~63%) ──────────────────────────────── */}
          <div className="min-w-0 flex-1 space-y-6">
            {/* Equipment Details */}
            <div>
              <SectionHeader label="Equipment Details" />
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-sm text-fg-3">Equipment Class</dt>
                  <dd className="mt-0.5 font-medium text-sm">
                    {equipmentClassLabels[item.equipmentClass] || item.equipmentClass}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">Appliance Type</dt>
                  <dd className="mt-0.5 font-medium text-sm">
                    {applianceTypeLabels[item.applianceType] || item.applianceType}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">Make</dt>
                  <dd className="mt-0.5 font-medium text-sm">{item.make || "\u2014"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">Model</dt>
                  <dd className="mt-0.5 font-medium text-sm">{item.modelName || "\u2014"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">Serial Number</dt>
                  <dd className="mt-0.5 font-mono font-medium text-sm t-data">
                    {item.serialNumber || "\u2014"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-3">Location</dt>
                  <dd className="mt-0.5 font-medium text-sm">{item.location || "\u2014"}</dd>
                </div>
              </div>
            </div>

            {/* Test History */}
            <div>
              <SectionHeader label={`Test History (${item._count.testRecords})`} />
              <div className="mt-3">
                {item.testRecords.length === 0 ? (
                  <EmptyState
                    preset="maintenance"
                    heading="No test records"
                    description="Record the first test to start tracking compliance."
                  />
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Test Date</TableHead>
                          <TableHead>Tester</TableHead>
                          <TableHead>Visual</TableHead>
                          <TableHead className="hidden sm:table-cell">Earth Cont.</TableHead>
                          <TableHead className="hidden sm:table-cell">Insulation</TableHead>
                          <TableHead className="hidden sm:table-cell">Leakage</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead className="hidden md:table-cell">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.testRecords.map((record: {
                          id: string;
                          testDate: string | Date;
                          testerName: string;
                          testedBy?: { id: string; name: string } | null;
                          visualInspectionResult: string;
                          earthContinuityResult: string;
                          insulationResult: string;
                          leakageCurrentResult: string;
                          result: string;
                          failureNotes?: string | null;
                          functionalTestNotes?: string | null;
                          visualNotes?: string | null;
                        }) => (
                          <TableRow key={record.id}>
                            <TableCell className="text-sm">{formatDate(record.testDate)}</TableCell>
                            <TableCell className="text-sm">
                              {record.testedBy?.name || record.testerName}
                            </TableCell>
                            <TableCell>{resultBadge(record.visualInspectionResult)}</TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {resultBadge(record.earthContinuityResult)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {resultBadge(record.insulationResult)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {resultBadge(record.leakageCurrentResult)}
                            </TableCell>
                            <TableCell>{resultBadge(record.result)}</TableCell>
                            <TableCell className="hidden md:table-cell max-w-48 truncate text-xs text-fg-3">
                              {record.failureNotes || record.functionalTestNotes || record.visualNotes || "\u2014"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Sidebar (~37%) ───────────────────────────────────── */}
          <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
            <div className="lg:sticky lg:top-4 space-y-4">
              {/* Status */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Status" />
                <div className="flex items-center gap-2">
                  <StatusIndicator
                    intent={statusIntentMap[item.status] || "neutral"}
                    label={statusLabelMap[item.status] || item.status}
                  />
                </div>
                {latestRecord && (
                  <div className="flex items-center gap-2">
                    <StatusIndicator
                      intent={latestRecord.result === "PASS" ? "success" : latestRecord.result === "FAIL" ? "error" : "neutral"}
                      label={`Last result: ${latestRecord.result === "PASS" ? "Pass" : latestRecord.result === "FAIL" ? "Fail" : latestRecord.result}`}
                    />
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Schedule" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Test Interval
                    </span>
                    <span className="font-medium">{item.testIntervalMonths} months</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3 flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Last Tested
                    </span>
                    <span className="font-medium">{formatDate(item.lastTestDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3 flex items-center gap-1">
                      <Wrench className="h-3.5 w-3.5" />
                      Next Due
                    </span>
                    <span className="font-medium">{formatDate(item.nextDueDate)}</span>
                  </div>
                </div>
              </div>

              {/* Equipment Info */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Equipment Info" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Tag ID</span>
                    <span className="font-mono font-medium t-data">{item.testTagId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Class</span>
                    <span className="font-medium">
                      {equipmentClassLabels[item.equipmentClass] || item.equipmentClass}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Type</span>
                    <span className="font-medium">
                      {applianceTypeLabels[item.applianceType] || item.applianceType}
                    </span>
                  </div>
                  {item.serialNumber && (
                    <div className="flex justify-between">
                      <span className="text-fg-3">Serial</span>
                      <span className="font-mono font-medium t-data">{item.serialNumber}</span>
                    </div>
                  )}
                  {item.location && (
                    <div className="flex justify-between">
                      <span className="text-fg-3 flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        Location
                      </span>
                      <span className="font-medium">{item.location}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Linked Asset */}
              {(item.asset || item.bulkAsset) && (
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Linked Asset" />
                  <div className="text-sm">
                    {item.asset && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                          <Link
                            href={`/assets/registry/${item.asset.id}`}
                            className="font-medium text-primary hover:underline truncate"
                          >
                            {item.asset.assetTag}
                            {item.asset.customName ? ` — ${item.asset.customName}` : ""}
                          </Link>
                        </div>
                        {item.asset.model && (
                          <p className="text-fg-3 text-xs ml-5">
                            {item.asset.model.manufacturer && `${item.asset.model.manufacturer} `}
                            {item.asset.model.name}
                          </p>
                        )}
                      </div>
                    )}
                    {item.bulkAsset && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5 text-fg-3 shrink-0" />
                          <Link
                            href={`/assets/registry/${item.bulkAsset.id}?type=bulk`}
                            className="font-medium text-primary hover:underline truncate"
                          >
                            {item.bulkAsset.assetTag}
                          </Link>
                        </div>
                        {item.bulkAsset.model && (
                          <p className="text-fg-3 text-xs ml-5">
                            {item.bulkAsset.model.manufacturer && `${item.bulkAsset.model.manufacturer} `}
                            {item.bulkAsset.model.name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Dates */}
              <div className="border-b border-border pb-4 space-y-2">
                <SectionHeader label="Dates" />
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-3">Created</span>
                    <span className="font-medium">{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-3">Updated</span>
                    <span className="font-medium">{formatDate(item.updatedAt)}</span>
                  </div>
                </div>
              </div>

              {/* Activity */}
              <div className="space-y-2">
                <SectionHeader label="Activity" />
                <ActivityTimeline entityType="testTagAsset" entityId={id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

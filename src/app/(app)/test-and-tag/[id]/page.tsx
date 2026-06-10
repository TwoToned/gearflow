"use client";

import { use, Fragment, Suspense, useState } from "react";
import Link from "next/link";
// useQueryClient retained only for the cross-domain ["test-tag-assets"] list key
// (read in the test-and-tag registry). The ["test-tag-asset"] detail datum is on
// useServerQuery (same-view, not in the SSE map).
import { useQueryClient } from "@tanstack/react-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Zap,
  Pencil,
  Printer,
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
import { DeleteDialog } from "@/components/ui/delete-dialog";
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
import { DetailLayout, DetailMain, DetailSidebar, SectionHeader, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { LabelTemplate } from "@/components/test-tag/label-template";
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

  const { data: item, isLoading, error, refetch } = useServerQuery({
    queryKey: ["test-tag-asset", orgId, id],
    queryFn: () => getTestTagAsset(id),
  });

  const retireMutation = useServerMutation({
    mutationFn: () => retireTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset retired");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteTestTagAsset(id),
    onSuccess: () => {
      toast.success("Test tag asset deleted");
      queryClient.invalidateQueries({ queryKey: ["test-tag-assets"] });
      router.push("/test-and-tag/registry");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [retireOpen, setRetireOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
                {latestRecord && (
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print Label
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {item.status !== "RETIRED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setRetireOpen(true)}
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
                    onClick={() => setDeleteOpen(true)}
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
        <DetailLayout>
          {/* ── Main content (~63%) ──────────────────────────────── */}
          <DetailMain className="space-y-6">
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
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {item.testRecords.map((record: any) => {
                          const isExpanded = expandedRecordId === record.id;
                          return (
                            <Fragment key={record.id}>
                              <TableRow
                                className="cursor-pointer hover:bg-surface-hover"
                                onClick={() => setExpandedRecordId(isExpanded ? null : record.id)}
                              >
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
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={8} className="bg-bg-inset p-4">
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                                      {/* Readings */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-fg-1">Electrical Readings</h4>
                                        <dl className="space-y-1 text-fg-3">
                                          {record.earthContinuityReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Earth Continuity</dt>
                                              <dd className="font-mono text-fg-2">{record.earthContinuityReading} &#8486;</dd>
                                            </div>
                                          )}
                                          {record.insulationReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Insulation{record.insulationTestVoltage ? ` (${record.insulationTestVoltage}V)` : ""}</dt>
                                              <dd className="font-mono text-fg-2">{record.insulationReading} M&#8486;</dd>
                                            </div>
                                          )}
                                          {record.leakageCurrentReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Leakage Current</dt>
                                              <dd className="font-mono text-fg-2">{record.leakageCurrentReading} mA</dd>
                                            </div>
                                          )}
                                          {record.polarityResult && record.polarityResult !== "NOT_APPLICABLE" && (
                                            <div className="flex justify-between">
                                              <dt>Polarity</dt>
                                              <dd>{resultBadge(record.polarityResult)}</dd>
                                            </div>
                                          )}
                                          {record.rcdTripTimeReading != null && (
                                            <div className="flex justify-between">
                                              <dt>RCD Trip Time</dt>
                                              <dd className="font-mono text-fg-2">{record.rcdTripTimeReading} ms</dd>
                                            </div>
                                          )}
                                          {record.earthContinuityReading == null && record.insulationReading == null && record.leakageCurrentReading == null && (
                                            <p className="text-fg-3">No electrical readings recorded</p>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Visual Checks */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-fg-1">Visual Inspection</h4>
                                        <dl className="space-y-1 text-fg-3">
                                          {[
                                            ["Cord Condition", record.visualCordCondition],
                                            ["Plug Condition", record.visualPlugCondition],
                                            ["Housing", record.visualHousingCondition],
                                            ["Switch", record.visualSwitchCondition],
                                            ["Vents", record.visualVentsUnobstructed],
                                            ["Cord Grip", record.visualCordGrip],
                                            ["Earth Pin", record.visualEarthPin],
                                            ["Markings", record.visualMarkingsLegible],
                                            ["No Modifications", record.visualNoModifications],
                                          ].filter(([, v]) => v != null).map(([label, value]) => (
                                            <div key={label as string} className="flex justify-between">
                                              <dt>{label}</dt>
                                              <dd>{typeof value === "boolean"
                                                ? <Badge variant={value ? "default" : "destructive"} className="text-[10px]">{value ? "OK" : "FAIL"}</Badge>
                                                : resultBadge(value as string)}</dd>
                                            </div>
                                          ))}
                                          {record.visualNotes && (
                                            <div className="pt-1">
                                              <dt className="text-xs text-fg-3">Notes</dt>
                                              <dd className="text-fg-2">{record.visualNotes}</dd>
                                            </div>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Meta */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-fg-1">Details</h4>
                                        <dl className="space-y-1 text-fg-3">
                                          {record.testMethod && (
                                            <div className="flex justify-between">
                                              <dt>Test Method</dt>
                                              <dd className="text-fg-2">{record.testMethod.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.equipmentClassTested && (
                                            <div className="flex justify-between">
                                              <dt>Class Tested</dt>
                                              <dd className="text-fg-2">{record.equipmentClassTested.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.nextDueDate && (
                                            <div className="flex justify-between">
                                              <dt>Next Due</dt>
                                              <dd className="text-fg-2">{formatDate(record.nextDueDate)}</dd>
                                            </div>
                                          )}
                                          {record.failureAction && record.failureAction !== "NONE" && (
                                            <div className="flex justify-between">
                                              <dt>Failure Action</dt>
                                              <dd className="text-fg-2">{record.failureAction.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.failureNotes && (
                                            <div className="pt-1">
                                              <dt className="text-xs text-fg-3">Failure Notes</dt>
                                              <dd className="text-fg-2">{record.failureNotes}</dd>
                                            </div>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Sub-tests */}
                                      {record.subTestRecords && record.subTestRecords.length > 0 && (
                                        <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                                          <h4 className="font-medium text-fg-1">Sub-Tests</h4>
                                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {record.subTestRecords.map((st: any) => (
                                              <div key={st.id} className="border rounded p-2 text-xs">
                                                <div className="flex items-center justify-between mb-1">
                                                  <span className="font-medium">{st.label}</span>
                                                  {resultBadge(st.result)}
                                                </div>
                                                <dl className="space-y-0.5 text-fg-3">
                                                  {st.earthContinuityReading != null && (
                                                    <div className="flex justify-between"><dt>Earth</dt><dd className="font-mono">{st.earthContinuityReading} &#8486;</dd></div>
                                                  )}
                                                  {st.insulationReading != null && (
                                                    <div className="flex justify-between"><dt>Insulation</dt><dd className="font-mono">{st.insulationReading} M&#8486;</dd></div>
                                                  )}
                                                  {st.leakageCurrentReading != null && (
                                                    <div className="flex justify-between"><dt>Leakage</dt><dd className="font-mono">{st.leakageCurrentReading} mA</dd></div>
                                                  )}
                                                </dl>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </DetailMain>

          {/* ── Sidebar (~37%) ───────────────────────────────────── */}
          <DetailSidebar>
              {/* Status */}
              <SidebarSection title="Status">
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
              </SidebarSection>

              {/* Schedule */}
              <SidebarSection title="Schedule">
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
              </SidebarSection>

              {/* Equipment Info */}
              <SidebarSection title="Equipment Info">
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
              </SidebarSection>

              {/* Linked Asset */}
              {(item.asset || item.bulkAsset) && (
                <SidebarSection title="Linked Asset">
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
                </SidebarSection>
              )}

              {/* Dates */}
              <SidebarSection title="Dates">
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
              </SidebarSection>

              {/* Activity */}
              <SidebarSection title="Activity" divider={false}>
                <ActivityTimeline entityType="testTagAsset" entityId={id} />
              </SidebarSection>
          </DetailSidebar>
        </DetailLayout>
      </div>
      {/* Hidden label for printing */}
      {latestRecord && (
        <div className="hidden print:block">
          <LabelTemplate
            testTagId={item.testTagId}
            result={latestRecord.result === "PASS" ? "PASS" : "FAIL"}
            testDate={latestRecord.testDate}
            nextDueDate={item.nextDueDate || latestRecord.testDate}
            testerName={latestRecord.testedBy?.name || latestRecord.testerName || "—"}
          />
        </div>
      )}
      <DeleteDialog
        open={retireOpen}
        onOpenChange={setRetireOpen}
        title="Retire this test tag asset?"
        description="The asset is marked RETIRED. Its test history is preserved. You can permanently delete it later."
        confirmLabel="Retire asset"
        onConfirm={() => {
          retireMutation.mutate();
          setRetireOpen(false);
        }}
        pending={retireMutation.isPending}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this test tag asset?"
        description="Permanently removes the asset and all its test-and-tag records. This cannot be undone."
        confirmLabel="Delete asset"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </FadeIn>
  );
}

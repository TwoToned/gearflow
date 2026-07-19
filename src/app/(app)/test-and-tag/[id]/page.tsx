"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, Fragment, Suspense, useState } from "react";
import Link from "next/link";
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

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
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
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SectionHeader, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { LabelTemplate } from "@/components/test-tag/label-template";
import { cn, focusRing } from "@/lib/utils";
import { testTagStatusLabels, testTagResultLabels, equipmentClassLabels, applianceTypeLabels } from "@/lib/status-labels";

// ─── Helpers ──────────────────────────────────────────────────────

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
    return <span className="text-muted text-caption">{testTagResultLabels.NOT_APPLICABLE}</span>;
  return <span className="text-muted text-caption">{result}</span>;
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
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const ttWrites = useTestTagWrites();

  const { data: item, isLoading, error, refetch } = useServerQuery({
    queryKey: ["test-tag-asset", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.testTagAssets.detail, { id, orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  const retireMutation = useServerMutation({
    mutationFn: () => ttWrites.retire(id),
    onSuccess: () => {
      toast.success("Test tag asset retired");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => ttWrites.remove(id),
    onSuccess: () => {
      toast.success("Test tag asset deleted");
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
      <div className="rounded-[var(--r)] border-l-4 border-l-t-out bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)]">
        <p className="t-heading text-ink">{error ? "Couldn't load this asset" : "Test tag asset not found"}</p>
        <p className="text-caption text-muted mt-1">
          {error ? error.message : "It may have been deleted, or the link is incorrect."}
        </p>
        <div className="mt-4 flex gap-2">
          {error && (
            <Button variant="line" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/test-and-tag/registry">Back to registry</Link>
          </Button>
        </div>
      </div>
    );
  }

  const latestRecord = item.testRecords[0] ?? null;

  // Mobile card layout for the test-history table (rendered below `md`). Each
  // `cell` is pure/presentational and mirrors the desktop <TableCell> content.
  // Flat card per test record — desktop row expansion (readings/visual/meta) is
  // intentionally not reproduced on mobile for v1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testHistoryColumns: ColumnDef<any>[] = [
    {
      id: "testDate",
      header: "Test date",
      mobile: "title",
      cell: (record) => <span className="t-data">{formatDate(record.testDate)}</span>,
    },
    {
      id: "tester",
      header: "Tester",
      mobile: "subtitle",
      cell: (record) => <span>{record.testedBy?.name || record.testerName}</span>,
    },
    {
      id: "result",
      header: "Result",
      mobile: "badge",
      cell: (record) => resultBadge(record.result),
    },
    {
      id: "visual",
      header: "Visual",
      mobile: "meta",
      cell: (record) => resultBadge(record.visualInspectionResult),
    },
    {
      id: "earthContinuity",
      header: "Earth cont.",
      mobile: "meta",
      cell: (record) => resultBadge(record.earthContinuityResult),
    },
    {
      id: "insulation",
      header: "Insulation",
      mobile: "meta",
      cell: (record) => resultBadge(record.insulationResult),
    },
    {
      id: "leakage",
      header: "Leakage",
      mobile: "meta",
      cell: (record) => resultBadge(record.leakageCurrentResult),
    },
    {
      id: "notes",
      header: "Notes",
      mobile: "meta",
      mobileEmpty: (record) =>
        !record.failureNotes && !record.functionalTestNotes && !record.visualNotes,
      cell: (record) => (
        <span className="text-caption text-muted">
          {record.failureNotes || record.functionalTestNotes || record.visualNotes || "—"}
        </span>
      ),
    },
  ];

  return (
    <FadeIn>
      <PageMeta title={`${item.testTagId} — Test & tag`} />
      <div className="space-y-6">
        {/* ── Header (full width) ────────────────────────────────── */}
        <div>
          {/* Breadcrumb */}
          <nav className="mb-2 flex items-center gap-1 text-ui-text text-muted">
            <Link href="/test-and-tag" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Test & tag
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href="/test-and-tag/registry" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>
              Registry
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="t-mono text-ink-2">{item.testTagId}</span>
          </nav>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title text-ink">{item.testTagId}</h1>
                <StatusIndicator
                  category="testTag"
                  value={item.status}
                  label={testTagStatusLabels[item.status ?? "NOT_YET_TESTED"] || (item.status ?? "")}
                />
                {latestRecord && (
                  <StatusIndicator
                    category="testTagResult"
                    value={latestRecord.result}
                    label={`Last: ${testTagResultLabels[latestRecord.result ?? ""] ?? latestRecord.result}`}
                  />
                )}
              </div>
              <p className="text-muted mt-0.5">
                {item.description}
                {item.make && <> &middot; {item.make}</>}
                {item.modelName && <> {item.modelName}</>}
              </p>
            </div>

            <CanDo resource="testTag" action="update">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link href={`/test-and-tag/quick-test?id=${item.testTagId}`}>
                    <Zap className="mr-2 h-4 w-4" />
                    Record test
                  </Link>
                </Button>
                {latestRecord && (
                  <Button variant="line" size="sm" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print label
                  </Button>
                )}
                <Button variant="line" size="sm" disabled>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                {item.status !== "RETIRED" && (
                  <Button
                    variant="line"
                    size="sm"
                    className="border-transparent text-t-out hover:bg-out-soft hover:text-t-out"
                    onClick={() => setRetireOpen(true)}
                    loading={retireMutation.isPending}
                  >
                    <ArchiveX className="mr-2 h-4 w-4" />
                    Retire
                  </Button>
                )}
                {item.status === "RETIRED" && (
                  <Button
                    variant="line"
                    size="sm"
                    className="border-transparent text-t-out hover:bg-red hover:text-white"
                    onClick={() => setDeleteOpen(true)}
                    loading={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
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
              <SectionHeader label="Equipment details" />
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-ui-text text-muted">Equipment class</dt>
                  <dd className="mt-0.5 font-medium text-ui-text text-ink">
                    {equipmentClassLabels[item.equipmentClass ?? "CLASS_I"] || item.equipmentClass}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-text text-muted">Appliance type</dt>
                  <dd className="mt-0.5 font-medium text-ui-text text-ink">
                    {applianceTypeLabels[item.applianceType ?? "APPLIANCE"] || item.applianceType}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-text text-muted">Make</dt>
                  <dd className="mt-0.5 font-medium text-ui-text text-ink">{item.make || "\u2014"}</dd>
                </div>
                <div>
                  <dt className="text-ui-text text-muted">Model</dt>
                  <dd className="mt-0.5 font-medium text-ui-text text-ink">{item.modelName || "\u2014"}</dd>
                </div>
                <div>
                  <dt className="text-ui-text text-muted">Serial number</dt>
                  <dd className="mt-0.5 t-mono font-medium text-ui-text text-ink t-data">
                    {item.serialNumber || "\u2014"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-text text-muted">Location</dt>
                  <dd className="mt-0.5 font-medium text-ui-text text-ink">{item.location || "\u2014"}</dd>
                </div>
              </div>
            </div>

            {/* Test History */}
            <div>
              <SectionHeader label={`Test history (${item._count.testRecords})`} />
              <div className="mt-3">
                {item.testRecords.length === 0 ? (
                  <EmptyState
                    title="No test records"
                    description="Record the first test to start tracking compliance."
                  />
                ) : (
                  <>
                  <div className="hidden md:block rounded-[var(--r)] ring-1 ring-line overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Test date</TableHead>
                          <TableHead>Tester</TableHead>
                          <TableHead>Visual</TableHead>
                          <TableHead className="hidden sm:table-cell">Earth cont.</TableHead>
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
                                className="cursor-pointer hover:bg-elev"
                                onClick={() => setExpandedRecordId(isExpanded ? null : record.id)}
                              >
                                <TableCell className="text-table-cell t-data">{formatDate(record.testDate)}</TableCell>
                                <TableCell className="text-table-cell">
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
                                <TableCell className="hidden md:table-cell max-w-48 truncate text-caption text-muted">
                                  {record.failureNotes || record.functionalTestNotes || record.visualNotes || "\u2014"}
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={8} className="bg-paper-2 p-4">
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-ui-text">
                                      {/* Readings */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-ink">Electrical readings</h4>
                                        <dl className="space-y-1 text-muted">
                                          {record.earthContinuityReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Earth continuity</dt>
                                              <dd className="t-mono text-ink-2 t-data">{record.earthContinuityReading} &#8486;</dd>
                                            </div>
                                          )}
                                          {record.insulationReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Insulation{record.insulationTestVoltage ? ` (${record.insulationTestVoltage}V)` : ""}</dt>
                                              <dd className="t-mono text-ink-2 t-data">{record.insulationReading} M&#8486;</dd>
                                            </div>
                                          )}
                                          {record.leakageCurrentReading != null && (
                                            <div className="flex justify-between">
                                              <dt>Leakage current</dt>
                                              <dd className="t-mono text-ink-2 t-data">{record.leakageCurrentReading} mA</dd>
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
                                              <dt>RCD trip time</dt>
                                              <dd className="t-mono text-ink-2 t-data">{record.rcdTripTimeReading} ms</dd>
                                            </div>
                                          )}
                                          {record.earthContinuityReading == null && record.insulationReading == null && record.leakageCurrentReading == null && (
                                            <p className="text-muted">No electrical readings recorded</p>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Visual Checks */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-ink">Visual inspection</h4>
                                        <dl className="space-y-1 text-muted">
                                          {[
                                            ["Cord condition", record.visualCordCondition],
                                            ["Plug condition", record.visualPlugCondition],
                                            ["Housing", record.visualHousingCondition],
                                            ["Switch", record.visualSwitchCondition],
                                            ["Vents", record.visualVentsUnobstructed],
                                            ["Cord grip", record.visualCordGrip],
                                            ["Earth pin", record.visualEarthPin],
                                            ["Markings", record.visualMarkingsLegible],
                                            ["No modifications", record.visualNoModifications],
                                          ].filter(([, v]) => v != null).map(([label, value]) => (
                                            <div key={label as string} className="flex justify-between">
                                              <dt>{label}</dt>
                                              <dd>{typeof value === "boolean"
                                                ? <Badge status={value ? "ok" : "overbooked"}>{value ? "OK" : "Fail"}</Badge>
                                                : resultBadge(value as string)}</dd>
                                            </div>
                                          ))}
                                          {record.visualNotes && (
                                            <div className="pt-1">
                                              <dt className="text-caption text-muted">Notes</dt>
                                              <dd className="text-ink-2">{record.visualNotes}</dd>
                                            </div>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Meta */}
                                      <div className="space-y-2">
                                        <h4 className="font-medium text-ink">Details</h4>
                                        <dl className="space-y-1 text-muted">
                                          {record.testMethod && (
                                            <div className="flex justify-between">
                                              <dt>Test method</dt>
                                              <dd className="text-ink-2">{record.testMethod.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.equipmentClassTested && (
                                            <div className="flex justify-between">
                                              <dt>Class tested</dt>
                                              <dd className="text-ink-2">{record.equipmentClassTested.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.nextDueDate && (
                                            <div className="flex justify-between">
                                              <dt>Next due</dt>
                                              <dd className="text-ink-2 t-data">{formatDate(record.nextDueDate)}</dd>
                                            </div>
                                          )}
                                          {record.failureAction && record.failureAction !== "NONE" && (
                                            <div className="flex justify-between">
                                              <dt>Failure action</dt>
                                              <dd className="text-ink-2">{record.failureAction.replace(/_/g, " ")}</dd>
                                            </div>
                                          )}
                                          {record.failureNotes && (
                                            <div className="pt-1">
                                              <dt className="text-caption text-muted">Failure notes</dt>
                                              <dd className="text-ink-2">{record.failureNotes}</dd>
                                            </div>
                                          )}
                                        </dl>
                                      </div>

                                      {/* Sub-tests */}
                                      {record.subTestRecords && record.subTestRecords.length > 0 && (
                                        <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                                          <h4 className="font-medium text-ink">Sub-tests</h4>
                                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            {record.subTestRecords.map((st: any) => (
                                              <div key={st.id} className="rounded-[var(--r)] ring-1 ring-line p-2 text-caption">
                                                <div className="flex items-center justify-between mb-1">
                                                  <span className="font-medium text-ink">{st.label}</span>
                                                  {resultBadge(st.result)}
                                                </div>
                                                <dl className="space-y-0.5 text-muted">
                                                  {st.earthContinuityReading != null && (
                                                    <div className="flex justify-between"><dt>Earth</dt><dd className="t-mono t-data">{st.earthContinuityReading} &#8486;</dd></div>
                                                  )}
                                                  {st.insulationReading != null && (
                                                    <div className="flex justify-between"><dt>Insulation</dt><dd className="t-mono t-data">{st.insulationReading} M&#8486;</dd></div>
                                                  )}
                                                  {st.leakageCurrentReading != null && (
                                                    <div className="flex justify-between"><dt>Leakage</dt><dd className="t-mono t-data">{st.leakageCurrentReading} mA</dd></div>
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
                  <MobileCardList
                    className="md:hidden"
                    data={item.testRecords}
                    columns={testHistoryColumns}
                    getRowId={(record) => record.id}
                  />
                  </>
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
                    category="testTag"
                    value={item.status}
                    label={testTagStatusLabels[item.status ?? "NOT_YET_TESTED"] || (item.status ?? "")}
                  />
                </div>
                {latestRecord && (
                  <div className="flex items-center gap-2">
                    <StatusIndicator
                      category="testTagResult"
                      value={latestRecord.result}
                      label={`Last result: ${testTagResultLabels[latestRecord.result ?? ""] ?? latestRecord.result}`}
                    />
                  </div>
                )}
              </SidebarSection>

              {/* Schedule */}
              <SidebarSection title="Schedule">
                <div className="space-y-1 text-ui-text">
                  <div className="flex justify-between">
                    <span className="text-muted flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Test interval
                    </span>
                    <span className="font-medium text-ink t-data">{item.testIntervalMonths} months</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Last tested
                    </span>
                    <span className="font-medium text-ink t-data">{formatDate(item.lastTestDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted flex items-center gap-1">
                      <Wrench className="h-3.5 w-3.5" />
                      Next due
                    </span>
                    <span className="font-medium text-ink t-data">{formatDate(item.nextDueDate)}</span>
                  </div>
                </div>
              </SidebarSection>

              {/* Equipment Info */}
              <SidebarSection title="Equipment info">
                <div className="space-y-1 text-ui-text">
                  <div className="flex justify-between">
                    <span className="text-muted">Tag ID</span>
                    <span className="t-mono font-medium text-ink t-data">{item.testTagId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Class</span>
                    <span className="font-medium text-ink">
                      {equipmentClassLabels[item.equipmentClass ?? "CLASS_I"] || item.equipmentClass}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Type</span>
                    <span className="font-medium text-ink">
                      {applianceTypeLabels[item.applianceType ?? "APPLIANCE"] || item.applianceType}
                    </span>
                  </div>
                  {item.serialNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted">Serial</span>
                      <span className="t-mono font-medium text-ink t-data">{item.serialNumber}</span>
                    </div>
                  )}
                  {item.location && (
                    <div className="flex justify-between">
                      <span className="text-muted flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        Location
                      </span>
                      <span className="font-medium text-ink">{item.location}</span>
                    </div>
                  )}
                </div>
              </SidebarSection>

              {/* Linked Asset */}
              {(item.asset || item.bulkAsset) && (
                <SidebarSection title="Linked asset">
                  <div className="text-ui-text">
                    {item.asset && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5 text-muted shrink-0" />
                          <Link
                            href={`/assets/registry/${item.asset.id}`}
                            className={cn("t-mono font-medium text-link hover:underline truncate rounded-sm", focusRing)}
                          >
                            {item.asset.assetTag}
                            {item.asset.customName ? ` — ${item.asset.customName}` : ""}
                          </Link>
                        </div>
                        {item.asset.model && (
                          <p className="text-muted text-caption ml-5">
                            {item.asset.model.manufacturer && `${item.asset.model.manufacturer} `}
                            {item.asset.model.name}
                          </p>
                        )}
                      </div>
                    )}
                    {item.bulkAsset && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5 text-muted shrink-0" />
                          <Link
                            href={`/assets/registry/${item.bulkAsset.id}?type=bulk`}
                            className={cn("t-mono font-medium text-link hover:underline truncate rounded-sm", focusRing)}
                          >
                            {item.bulkAsset.assetTag}
                          </Link>
                        </div>
                        {item.bulkAsset.model && (
                          <p className="text-muted text-caption ml-5">
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
                <div className="space-y-1 text-ui-text">
                  <div className="flex justify-between">
                    <span className="text-muted">Created</span>
                    <span className="font-medium text-ink t-data">{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Updated</span>
                    <span className="font-medium text-ink t-data">{formatDate(item.updatedAt)}</span>
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
            testDate={latestRecord.testDate ?? ""}
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

"use client";

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import Link from "next/link";
import {
  Package,
  Boxes,
  FolderOpen,
  Box,
  Users,
  MapPin,
  Wrench,
  DollarSign,
  BarChart3,
  Plus,
  Star,
  TrendingUp,
  AlertTriangle,
  HardHat,
  UserCheck,
  ScrollText,
  Clock,
  Truck,
  ShieldAlert,
  Trophy,
  Calculator,
  Wallet,
  Pin,
  PinOff,
  Trash2,
  Play,
  Edit,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/page-layouts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from "@/components/ui/motion";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  getReportsSummary,
  getSavedReports,
  deleteSavedReport,
  togglePinReport,
} from "@/server/reports";
import { ReportViewer } from "@/components/reports/report-viewer";
import {
  PRE_BUILT_REPORTS,
  getReportsByCategory,
  type PreBuiltReport,
  type ReportConfig,
} from "@/lib/report-types";
import { assetStatusLabels, projectStatusLabels, maintenanceStatusLabels, formatLabel } from "@/lib/status-labels";

const ICON_MAP: Record<string, React.ReactNode> = {
  Package: <Package className="h-4 w-4" />,
  Boxes: <Boxes className="h-4 w-4" />,
  FolderOpen: <FolderOpen className="h-4 w-4" />,
  Box: <Box className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  MapPin: <MapPin className="h-4 w-4" />,
  Wrench: <Wrench className="h-4 w-4" />,
  DollarSign: <DollarSign className="h-4 w-4" />,
  BarChart3: <BarChart3 className="h-4 w-4" />,
  Star: <Star className="h-4 w-4" />,
  TrendingUp: <TrendingUp className="h-4 w-4" />,
  AlertTriangle: <AlertTriangle className="h-4 w-4" />,
  HardHat: <HardHat className="h-4 w-4" />,
  UserCheck: <UserCheck className="h-4 w-4" />,
  ScrollText: <ScrollText className="h-4 w-4" />,
  Clock: <Clock className="h-4 w-4" />,
  Truck: <Truck className="h-4 w-4" />,
  ShieldAlert: <ShieldAlert className="h-4 w-4" />,
  Trophy: <Trophy className="h-4 w-4" />,
  Calculator: <Calculator className="h-4 w-4" />,
  Wallet: <Wallet className="h-4 w-4" />,
};

export default function ReportsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [activeReport, setActiveReport] = useState<{
    config: ReportConfig;
    title: string;
  } | null>(null);

  const { data: summary, isLoading: summaryLoading } = useServerQuery({
    queryKey: ["reports-summary", orgId],
    queryFn: getReportsSummary,
  });

  const { data: savedReports, refetch: refetchSavedReports } = useServerQuery({
    queryKey: ["saved-reports", orgId],
    queryFn: getSavedReports,
  });

  const deleteMutation = useServerMutation({
    mutationFn: deleteSavedReport,
    onSuccess: () => refetchSavedReports(),
  });

  const pinMutation = useServerMutation({
    mutationFn: togglePinReport,
    onSuccess: () => refetchSavedReports(),
  });

  const reportsByCategory = getReportsByCategory();
  const d = summary as Record<string, unknown> | undefined;
  const assetsByStatus = (d?.assetsByStatus as Array<{ status: string; count: number }>) ?? [];
  const projectsByStatus = (d?.projectsByStatus as Array<{ status: string; count: number }>) ?? [];
  const maintenanceSummary = (d?.maintenanceSummary as Array<{ status: string; count: number }>) ?? [];

  type SavedReportRow = {
    id: string;
    name: string;
    description: string | null;
    dataSource: string;
    config: ReportConfig;
    isPinned: boolean;
    isShared: boolean;
    createdBy: { id: string; name: string } | null;
  };

  const pinnedReports = ((savedReports as unknown as SavedReportRow[]) ?? []).filter((r) => r.isPinned);
  const myReports = ((savedReports as unknown as SavedReportRow[]) ?? []);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Build contextual description
  const totalAssets = !summaryLoading && d
    ? ((d.totalSerializedAssets as number) || 0) + ((d.totalBulkAssets as number) || 0)
    : 0;
  const categoryCount = Object.keys(reportsByCategory).length;
  const reportCount = PRE_BUILT_REPORTS.length;
  const description = !summaryLoading && d
    ? `${totalAssets.toLocaleString()} assets tracked across ${reportCount} available reports`
    : "Utilisation, revenue, and operational insights";

  return (
    <RequirePermission resource="reports" action="view">
      <div className="space-y-8">
        <FadeIn>
          <PageHeader
            title="Reports"
            description={description}
            actions={
              <Button render={<Link href="/reports/builder" />}>
                <Plus className="mr-1.5 h-4 w-4" /> Custom Report
              </Button>
            }
          />
        </FadeIn>

        {/* Quick Stats */}
        {!summaryLoading && d && (
          <FadeIn delay={0.05}>
            <SectionHeader label="Overview" />
            <StaggerList className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StaggerItem>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="t-title t-data leading-tight">
                      <AnimatedNumber value={d.totalSerializedAssets as number} />
                    </div>
                    <p className="text-xs text-fg-3">Serialized Assets</p>
                  </div>
                </div>
              </StaggerItem>
              <StaggerItem>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Boxes className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="t-title t-data leading-tight">
                      <AnimatedNumber value={d.totalBulkAssets as number} />
                    </div>
                    <p className="text-xs text-fg-3">Bulk Assets</p>
                  </div>
                </div>
              </StaggerItem>
              <StaggerItem>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="t-title t-data leading-tight">
                      <AnimatedNumber value={d.totalClients as number} />
                    </div>
                    <p className="text-xs text-fg-3">Clients</p>
                  </div>
                </div>
              </StaggerItem>
              <StaggerItem>
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <DollarSign className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="t-title t-data leading-tight">
                      ${((d.totalRevenue as number) || 0).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <p className="text-xs text-fg-3">Total Revenue</p>
                  </div>
                </div>
              </StaggerItem>
            </StaggerList>
          </FadeIn>
        )}

        {/* Status Breakdowns */}
        {!summaryLoading && d && (
          <FadeIn delay={0.1}>
            <SectionHeader label="Status Breakdown" />
            <div className="mt-3 grid gap-6 lg:grid-cols-3">
              <div>
                <h3 className="t-heading text-fg flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4" /> Assets by Status
                </h3>
                {assetsByStatus.length === 0 ? (
                  <p className="text-sm text-fg-3">No assets yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {assetsByStatus.map((g) => (
                      <div key={g.status} className="flex items-center justify-between py-1">
                        <span className="text-sm">{assetStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="t-heading text-fg flex items-center gap-2 mb-3">
                  <FolderOpen className="h-4 w-4" /> Projects by Status
                </h3>
                {projectsByStatus.length === 0 ? (
                  <p className="text-sm text-fg-3">No projects yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {projectsByStatus.map((g) => (
                      <div key={g.status} className="flex items-center justify-between py-1">
                        <span className="text-sm">{projectStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="t-heading text-fg flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4" /> Maintenance
                </h3>
                {maintenanceSummary.length === 0 ? (
                  <p className="text-sm text-fg-3">No records yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {maintenanceSummary.map((g) => (
                      <div key={g.status} className="flex items-center justify-between py-1">
                        <span className="text-sm">{maintenanceStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </FadeIn>
        )}

        {/* Pinned Reports */}
        {pinnedReports.length > 0 && (
          <FadeIn delay={0.15}>
            <SectionHeader label="Pinned" />
            <StaggerList className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pinnedReports.map((report) => (
                <StaggerItem key={report.id}>
                  <div
                    className="rounded-lg border-l-2 border-l-primary bg-bg-surface p-4 surface-ring cursor-pointer transition-colors hover:ring-primary/50"
                    onClick={() => setActiveReport({ config: report.config, title: report.name })}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{report.name}</p>
                        {report.description && (
                          <p className="text-sm text-fg-3 mt-0.5">{report.description}</p>
                        )}
                      </div>
                      <Badge variant="outline">{report.dataSource}</Badge>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>
          </FadeIn>
        )}

        {/* Pre-built Reports */}
        <FadeIn delay={0.2}>
          <SectionHeader label="Report Library" />
          <div className="mt-3">
            {Object.entries(reportsByCategory).map(([category, reports]) => (
              <div key={category} className="mb-6 last:mb-0">
                <h3 className="text-[13px] font-medium text-fg-3 uppercase mb-2">{category}</h3>
                <StaggerList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {reports.map((report) => (
                    <StaggerItem key={report.id}>
                      <div
                        className="group rounded-lg p-4 cursor-pointer transition-colors hover:bg-bg-surface"
                        onClick={() => setActiveReport({ config: report.config, title: report.name })}
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-fg-3 mt-0.5 transition-colors group-hover:text-primary">
                            {ICON_MAP[report.icon] || <BarChart3 className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{report.name}</p>
                            <p className="text-xs text-fg-3">{report.description}</p>
                          </div>
                        </div>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerList>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* My Reports / Saved Reports */}
        {myReports.length > 0 && (
          <FadeIn delay={0.25}>
            <SectionHeader label="My Reports" />
            <StaggerList className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myReports.map((report) => (
                <StaggerItem key={report.id}>
                  <div className="rounded-lg bg-bg-surface p-4 surface-ring">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{report.name}</p>
                        {report.description && (
                          <p className="text-xs text-fg-3">{report.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {report.isShared && <Badge variant="outline">Shared</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveReport({ config: report.config, title: report.name })}
                      >
                        <Play className="mr-1 h-3 w-3" /> Run
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        render={<Link href={`/reports/builder/${report.id}`} />}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => pinMutation.mutate(report.id)}
                      >
                        {report.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </Button>
                      <Dialog open={deleteTarget === report.id} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                        <DialogTrigger render={<Button variant="ghost" size="sm" onClick={() => setDeleteTarget(report.id)} />}>
                          <Trash2 className="h-3 w-3" />
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Report</DialogTitle>
                          </DialogHeader>
                          <p className="text-sm text-fg-3">
                            Are you sure you want to delete &quot;{report.name}&quot;?
                          </p>
                          <div className="flex justify-end gap-2 mt-4">
                            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                            <Button
                              variant="destructive"
                              onClick={() => {
                                deleteMutation.mutate(report.id);
                                setDeleteTarget(null);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>
          </FadeIn>
        )}

        {/* Active Report Dialog */}
        <Dialog open={!!activeReport} onOpenChange={(open) => !open && setActiveReport(null)}>
          <DialogContent className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto">
            {activeReport && (
              <>
                <DialogHeader>
                  <DialogTitle>{activeReport.title}</DialogTitle>
                </DialogHeader>
                <div className="flex gap-2 -mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/reports/builder?config=${encodeURIComponent(JSON.stringify(activeReport.config))}`} />}
                  >
                    <Edit className="mr-1.5 h-3.5 w-3.5" /> Customise
                  </Button>
                </div>
                <ReportViewer key={activeReport.title} config={activeReport.config} title={activeReport.title} autoRun />
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </RequirePermission>
  );
}

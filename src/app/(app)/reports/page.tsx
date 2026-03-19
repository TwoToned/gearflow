"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { RequirePermission } from "@/components/auth/require-permission";
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
  const queryClient = useQueryClient();

  const [activeReport, setActiveReport] = useState<{
    config: ReportConfig;
    title: string;
  } | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["reports-summary", orgId],
    queryFn: getReportsSummary,
  });

  const { data: savedReports } = useQuery({
    queryKey: ["saved-reports", orgId],
    queryFn: getSavedReports,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedReport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-reports"] }),
  });

  const pinMutation = useMutation({
    mutationFn: togglePinReport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-reports"] }),
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

  return (
    <RequirePermission resource="reports" action="view">
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Utilisation, revenue, and operational insights."
          actions={
            <Button render={<Link href="/reports/builder" />}>
              <Plus className="mr-1.5 h-4 w-4" /> Custom Report
            </Button>
          }
        />

        {/* Quick Stats */}
        {!summaryLoading && d && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Serialized Assets</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d.totalSerializedAssets as number}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bulk Assets</CardTitle>
                <Boxes className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d.totalBulkAssets as number}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Clients</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d.totalClients as number}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${((d.totalRevenue as number) || 0).toLocaleString("en-AU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Completed &amp; invoiced projects</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Status Breakdowns */}
        {!summaryLoading && d && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" /> Assets by Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {assetsByStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assets yet.</p>
                ) : (
                  <div className="space-y-2">
                    {assetsByStatus.map((g) => (
                      <div key={g.status} className="flex items-center justify-between">
                        <span className="text-sm">{assetStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FolderOpen className="h-4 w-4" /> Projects by Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {projectsByStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                ) : (
                  <div className="space-y-2">
                    {projectsByStatus.map((g) => (
                      <div key={g.status} className="flex items-center justify-between">
                        <span className="text-sm">{projectStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4" /> Maintenance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {maintenanceSummary.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No records yet.</p>
                ) : (
                  <div className="space-y-2">
                    {maintenanceSummary.map((g) => (
                      <div key={g.status} className="flex items-center justify-between">
                        <span className="text-sm">{maintenanceStatusLabels[g.status] || formatLabel(g.status)}</span>
                        <Badge variant="secondary">{g.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Pinned Reports */}
        {pinnedReports.length > 0 && (
          <>
            <Separator />
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Pin className="h-4 w-4" /> Pinned Reports
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedReports.map((report) => (
                  <Card
                    key={report.id}
                    className="cursor-pointer transition-colors hover:border-primary"
                    onClick={() => setActiveReport({ config: report.config, title: report.name })}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{report.name}</p>
                          {report.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">{report.description}</p>
                          )}
                        </div>
                        <Badge variant="outline">{report.dataSource}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Pre-built Reports */}
        <Separator />
        <div>
          <h2 className="text-lg font-semibold mb-3">Report Library</h2>
          {Object.entries(reportsByCategory).map(([category, reports]) => (
            <div key={category} className="mb-6">
              <h3 className="text-sm font-medium text-muted-foreground uppercase mb-2">{category}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((report) => (
                  <Card
                    key={report.id}
                    className="cursor-pointer transition-colors hover:border-primary"
                    onClick={() => setActiveReport({ config: report.config, title: report.name })}
                  >
                    <CardContent className="flex items-start gap-3 p-4">
                      <div className="text-muted-foreground mt-0.5">
                        {ICON_MAP[report.icon] || <BarChart3 className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{report.name}</p>
                        <p className="text-xs text-muted-foreground">{report.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* My Reports / Saved Reports */}
        {myReports.length > 0 && (
          <>
            <Separator />
            <div>
              <h2 className="text-lg font-semibold mb-3">My Reports</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {myReports.map((report) => (
                  <Card key={report.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">{report.name}</p>
                          {report.description && (
                            <p className="text-xs text-muted-foreground">{report.description}</p>
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
                            <p className="text-sm text-muted-foreground">
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
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

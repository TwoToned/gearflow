"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Edit, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportScheduleCard } from "@/components/reports/report-schedule-card";
import { getSavedReportById } from "@/server/reports";
import { DATA_SOURCE_LABELS, type ReportConfig, type DataSource } from "@/lib/report-types";

export default function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: report, isLoading } = useQuery({
    queryKey: ["saved-report", id],
    queryFn: () => getSavedReportById(id),
  });

  if (isLoading) return <DetailPageSkeleton />;
  if (!report) return <div className="py-20 text-center text-fg-3">Report not found.</div>;

  const r = report as unknown as {
    id: string;
    name: string;
    description?: string;
    dataSource: DataSource;
    config: ReportConfig;
    isShared: boolean;
    createdBy: { name: string } | null;
  };

  return (
    <RequirePermission resource="reports" action="view">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Button variant="ghost" size="sm" render={<Link href="/reports" />}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="t-title text-fg">{r.name}</h1>
            </div>
            {r.description && (
              <p className="text-fg-3">{r.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline">{DATA_SOURCE_LABELS[r.dataSource]}</Badge>
              {r.isShared && <Badge variant="secondary">Shared</Badge>}
              {r.createdBy && (
                <span className="text-xs text-fg-3">by {r.createdBy.name}</span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" render={<Link href={`/reports/builder/${r.id}`} />}>
            <Edit className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
        </div>

        <ReportViewer config={r.config} title={r.name} />

        <ReportScheduleCard reportId={r.id} />
      </div>
    </RequirePermission>
  );
}

"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { RequirePermission } from "@/components/auth/require-permission";
import { ReportBuilder } from "@/components/reports/report-builder";
import { getSavedReportById } from "@/server/reports";
import type { ReportConfig } from "@/lib/report-types";

export default function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: report, isLoading } = useQuery({
    queryKey: ["saved-report", id],
    queryFn: () => getSavedReportById(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!report) return <div className="text-destructive">Report not found</div>;

  const r = report as unknown as { id: string; name: string; description?: string; config: ReportConfig };

  return (
    <RequirePermission resource="reports" action="view">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Report</h1>
          <p className="text-muted-foreground">Editing &quot;{r.name}&quot;</p>
        </div>
        <ReportBuilder
          initialConfig={r.config}
          savedReportId={r.id}
          savedReportName={r.name}
        />
      </div>
    </RequirePermission>
  );
}

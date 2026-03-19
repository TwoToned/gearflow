"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RequirePermission } from "@/components/auth/require-permission";
import { ReportBuilder } from "@/components/reports/report-builder";
import type { ReportConfig } from "@/lib/report-types";

function BuilderContent() {
  const searchParams = useSearchParams();
  const configParam = searchParams.get("config");

  let initialConfig: ReportConfig | undefined;
  if (configParam) {
    try {
      initialConfig = JSON.parse(configParam);
    } catch {
      // ignore parse error
    }
  }

  return (
    <RequirePermission resource="reports" action="view">
      <div className="space-y-6">
        <div>
          <h1 className="t-title text-fg">Custom Report Builder</h1>
          <p className="text-fg-3">
            Build a custom report by selecting a data source, columns, filters, and grouping.
          </p>
        </div>
        <ReportBuilder initialConfig={initialConfig} />
      </div>
    </RequirePermission>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<div className="text-fg-3">Loading...</div>}>
      <BuilderContent />
    </Suspense>
  );
}

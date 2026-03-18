"use client";

import { useState, useEffect, useRef } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReportResult, ReportConfig, FieldDefinition } from "@/lib/report-types";
import { FIELD_DEFINITIONS } from "@/lib/report-types";
import { useMutation } from "@tanstack/react-query";
import { runReport, runReportCSV } from "@/server/reports";

interface ReportViewerProps {
  config: ReportConfig;
  initialResult?: ReportResult;
  title?: string;
  autoRun?: boolean;
  onSave?: () => void;
}

export function ReportViewer({ config, initialResult, title, autoRun }: ReportViewerProps) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReportResult | null>(initialResult ?? null);
  const pageSize = config.limit || 100;
  const hasAutoRun = useRef(false);

  const runMutation = useMutation({
    mutationFn: async (p: number) => {
      const res = await runReport(config, p, pageSize);
      return res as ReportResult;
    },
    onSuccess: (data) => setResult(data),
  });

  const csvMutation = useMutation({
    mutationFn: () => runReportCSV(config),
    onSuccess: (csv) => {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "report"}-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const pdfMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, title: title || "Report" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "PDF generation failed" }));
        throw new Error(err.error || "PDF generation failed");
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  });

  // Auto-run on mount if requested
  useEffect(() => {
    if (autoRun && !hasAutoRun.current && !initialResult) {
      hasAutoRun.current = true;
      runMutation.mutate(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const handleRun = () => {
    setPage(1);
    runMutation.mutate(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    runMutation.mutate(newPage);
  };

  // Get field definitions for formatting
  const fieldDefs = FIELD_DEFINITIONS[config.dataSource] || [];

  const formatValue = (value: unknown, field: string): React.ReactNode => {
    if (value == null) return <span className="text-muted-foreground">-</span>;

    const fieldDef = fieldDefs.find((f) => f.field === field);

    if (fieldDef?.type === "enum" && fieldDef.enumLabels) {
      const label = fieldDef.enumLabels[String(value)] || String(value);
      return <Badge variant="secondary">{label}</Badge>;
    }

    if (fieldDef?.type === "date" || field.toLowerCase().includes("date") || field.toLowerCase().includes("at")) {
      const d = new Date(value as string);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
      }
    }

    if (fieldDef?.type === "number" || typeof value === "number") {
      const num = Number(value);
      // Check if it looks like currency
      if (field.toLowerCase().includes("price") || field.toLowerCase().includes("cost") ||
          field.toLowerCase().includes("total") || field.toLowerCase().includes("revenue") ||
          field.toLowerCase().includes("value") || field.toLowerCase().includes("amount") ||
          field.toLowerCase().includes("paid") || field.toLowerCase().includes("spend")) {
        return `$${num.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      return num.toLocaleString("en-AU");
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    return String(value);
  };

  const totalPages = result ? Math.ceil(result.totalRows / pageSize) : 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleRun} disabled={runMutation.isPending}>
          {runMutation.isPending ? "Running..." : result ? "Refresh" : "Run Report"}
        </Button>

        {result && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => csvMutation.mutate()}
              disabled={csvMutation.isPending}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {csvMutation.isPending ? "Exporting..." : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pdfMutation.mutate()}
              disabled={pdfMutation.isPending}
            >
              <FileText className="mr-1.5 h-4 w-4" />
              {pdfMutation.isPending ? "Generating..." : "Export PDF"}
            </Button>

            <span className="ml-auto text-sm text-muted-foreground">
              {result.totalRows.toLocaleString()} row{result.totalRows !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      {/* Error */}
      {runMutation.isError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {(runMutation.error as Error).message || "Failed to run report"}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((col) => (
                    <TableHead key={col.field} className="whitespace-nowrap">
                      {col.label || fieldDefs.find((f) => f.field === col.field)?.label || col.field}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={result.columns.length} className="text-center text-muted-foreground py-8">
                      No data found
                    </TableCell>
                  </TableRow>
                ) : (
                  result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((col) => (
                        <TableCell key={col.field} className="whitespace-nowrap">
                          {formatValue(row[col.field], col.field)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Aggregation summary */}
          {result.aggregations && Object.keys(result.aggregations).length > 1 && (
            <div className="flex flex-wrap gap-4 rounded-md border bg-muted/50 p-3">
              {Object.entries(result.aggregations)
                .filter(([key]) => key.startsWith("sum:"))
                .map(([key, value]) => {
                  const field = key.replace("sum:", "");
                  const label = fieldDefs.find((f) => f.field === field)?.label || field;
                  return (
                    <div key={key} className="text-sm">
                      <span className="text-muted-foreground">Total {label}:</span>{" "}
                      <span className="font-medium">{formatValue(value, field)}</span>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || runMutation.isPending}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || runMutation.isPending}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

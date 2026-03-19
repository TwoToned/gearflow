"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, FileText, AlertTriangle, ClipboardList, History,
  Calendar, BarChart3, Users, XCircle, Boxes, Shield,
  Download, FileDown, Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getTestTagAssets } from "@/server/test-tag-assets";
import { getReportPreviewCount, type ReportFilters } from "@/server/test-tag-reports";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";

type ReportType = "register" | "overdue" | "session" | "item-history" | "due-schedule" | "class-summary" | "tester-activity" | "failed-items" | "bulk-summary" | "compliance-certificate";

interface ReportConfig {
  key: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
  formats: ("PDF" | "CSV")[];
  filters: FilterField[];
}

type FilterField = "dateFrom" | "dateTo" | "search" | "testTagAssetId" | "bulkAssetId";

const reportConfigs: ReportConfig[] = [
  {
    key: "register",
    title: "Full Register",
    description: "Complete T&T inventory with current status. Ideal for auditors or insurers.",
    icon: FileText,
    formats: ["PDF", "CSV"],
    filters: ["search"],
  },
  {
    key: "overdue",
    title: "Overdue / Non-Compliant",
    description: "Items needing immediate action - overdue, failed, or not yet tested.",
    icon: AlertTriangle,
    formats: ["PDF", "CSV"],
    filters: [],
  },
  {
    key: "session",
    title: "Test Session Report",
    description: "Results from a testing session within a date range.",
    icon: ClipboardList,
    formats: ["PDF", "CSV"],
    filters: ["dateFrom", "dateTo"],
  },
  {
    key: "item-history",
    title: "Item History",
    description: "Full test history for a single item. Search by tag ID.",
    icon: History,
    formats: ["PDF"],
    filters: ["testTagAssetId"],
  },
  {
    key: "due-schedule",
    title: "Due For Testing",
    description: "Upcoming testing schedule for a date range.",
    icon: Calendar,
    formats: ["PDF", "CSV"],
    filters: ["dateFrom", "dateTo"],
  },
  {
    key: "class-summary",
    title: "Class Summary",
    description: "Fleet breakdown by equipment class and appliance type.",
    icon: BarChart3,
    formats: ["PDF", "CSV"],
    filters: [],
  },
  {
    key: "tester-activity",
    title: "Tester Activity",
    description: "Tests performed by each tester over a period.",
    icon: Users,
    formats: ["PDF", "CSV"],
    filters: ["dateFrom", "dateTo"],
  },
  {
    key: "failed-items",
    title: "Failed Items",
    description: "Detailed log of failures with reasons and actions taken.",
    icon: XCircle,
    formats: ["PDF", "CSV"],
    filters: ["dateFrom", "dateTo"],
  },
  {
    key: "bulk-summary",
    title: "Bulk Asset T&T Summary",
    description: "Status of all T&T items for a specific bulk asset type.",
    icon: Boxes,
    formats: ["PDF", "CSV"],
    filters: ["bulkAssetId"],
  },
  {
    key: "compliance-certificate",
    title: "Compliance Certificate",
    description: "Formal AS/NZS 3760 compliance statement for clients or venues.",
    icon: Shield,
    formats: ["PDF"],
    filters: [],
  },
];

function buildQueryString(filters: Record<string, string | undefined>, format: string): string {
  const params = new URLSearchParams();
  params.set("format", format);
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  return params.toString();
}

export default function TestTagReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportConfig | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // For item-history: search test tag assets
  const { data: searchResults } = useQuery({
    queryKey: ["test-tag-search", orgId, searchInput],
    queryFn: () => getTestTagAssets({ search: searchInput, pageSize: 5 }),
    enabled: activeReport?.key === "item-history" && searchInput.length >= 2,
  });

  // For bulk-summary: search bulk-linked test tag assets
  const { data: bulkAssets } = useQuery({
    queryKey: ["test-tag-bulk-assets", orgId],
    queryFn: () => getTestTagAssets({ assetLinkType: "bulk", pageSize: 100 }),
    enabled: activeReport?.key === "bulk-summary",
  });

  const handleGenerate = useCallback(async (format: "pdf" | "csv") => {
    if (!activeReport) return;

    // Validation
    if (activeReport.key === "item-history" && !filters.testTagAssetId) {
      toast.error("Please select a test tag item");
      return;
    }
    if (activeReport.key === "bulk-summary" && !filters.bulkAssetId) {
      toast.error("Please select a bulk asset");
      return;
    }

    setGenerating(true);
    try {
      const qs = buildQueryString(filters, format);
      const url = `/api/test-tag-reports/${activeReport.key}?${qs}`;

      if (format === "csv") {
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Download failed" }));
          throw new Error(err.error || "Download failed");
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tt-${activeReport.key}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success("CSV downloaded");
      } else {
        window.open(url, "_blank");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Report generation failed");
    } finally {
      setGenerating(false);
    }
  }, [activeReport, filters]);

  const openDialog = (config: ReportConfig) => {
    setActiveReport(config);
    setFilters({});
    setSearchInput("");
  };

  return (
    <RequirePermission resource="reports" action="view">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-title text-fg">Test & Tag Reports</h1>
          <p className="text-muted-foreground">Generate compliance reports and exports</p>
        </div>
        <Button variant="outline" render={<Link href="/test-and-tag" />}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Dashboard
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reportConfigs.map((config) => (
          <Card
            key={config.key}
            className="hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => openDialog(config)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <config.icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{config.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{config.description}</p>
              <div className="flex gap-2">
                {config.formats.map((format) => (
                  <span
                    key={format}
                    className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground"
                  >
                    {format}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Report Configuration Dialog */}
      <Dialog open={!!activeReport} onOpenChange={(open) => !open && setActiveReport(null)}>
        <DialogContent className="sm:max-w-md">
          {activeReport && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <activeReport.icon className="h-5 w-5 text-primary" />
                  {activeReport.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <p className="text-sm text-muted-foreground">{activeReport.description}</p>

                {/* Date From/To */}
                {activeReport.filters.includes("dateFrom") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="dateFrom">From</Label>
                      <Input
                        id="dateFrom"
                        type="date"
                        value={filters.dateFrom || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dateTo">To</Label>
                      <Input
                        id="dateTo"
                        type="date"
                        value={filters.dateTo || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                {/* Search */}
                {activeReport.filters.includes("search") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="search">Search</Label>
                    <Input
                      id="search"
                      value={filters.search || ""}
                      onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                      placeholder="Filter by tag ID, description, make, model..."
                    />
                  </div>
                )}

                {/* Item History: select item */}
                {activeReport.filters.includes("testTagAssetId") && (
                  <div className="space-y-1.5">
                    <Label>Select Item</Label>
                    <Input
                      value={searchInput}
                      onChange={(e) => {
                        setSearchInput(e.target.value);
                        setFilters((f) => ({ ...f, testTagAssetId: "" }));
                      }}
                      placeholder="Search by tag ID or description..."
                    />
                    {searchResults?.items && searchResults.items.length > 0 && !filters.testTagAssetId && (
                      <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                        {searchResults.items.map((item) => (
                          <button
                            key={item.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                            onClick={() => {
                              setFilters((f) => ({ ...f, testTagAssetId: item.id }));
                              setSearchInput(`${item.testTagId} - ${item.description}`);
                            }}
                          >
                            <span className="font-medium">{item.testTagId}</span>
                            <span className="text-muted-foreground ml-2">{item.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {filters.testTagAssetId && (
                      <p className="text-xs text-green-600">Item selected</p>
                    )}
                  </div>
                )}

                {/* Bulk Summary: select bulk asset */}
                {activeReport.filters.includes("bulkAssetId") && (
                  <div className="space-y-1.5">
                    <Label>Select Bulk Asset</Label>
                    {bulkAssets?.items && bulkAssets.items.length > 0 ? (
                      <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                        {/* Get unique bulk assets */}
                        {Array.from(
                          new Map(
                            bulkAssets.items
                              .filter((i) => i.bulkAsset)
                              .map((i) => [i.bulkAsset!.id, i.bulkAsset!])
                          ).values()
                        ).map((ba) => (
                          <button
                            key={ba.id}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${filters.bulkAssetId === ba.id ? "bg-primary/10" : ""}`}
                            onClick={() => setFilters((f) => ({ ...f, bulkAssetId: ba.id }))}
                          >
                            <span className="font-medium">{ba.assetTag}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No bulk assets with T&T items found.</p>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="flex gap-2 sm:justify-start">
                {activeReport.formats.includes("PDF") && (
                  <Button onClick={() => handleGenerate("pdf")} disabled={generating}>
                    {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                    Generate PDF
                  </Button>
                )}
                {activeReport.formats.includes("CSV") && (
                  <Button variant="outline" onClick={() => handleGenerate("csv")} disabled={generating}>
                    {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Download CSV
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </RequirePermission>
  );
}

"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  Package, Boxes, FolderOpen, Box, List, Users, MapPin,
  Wrench, ScrollText, HardHat, UserCheck, Plus, X, Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ReportViewer } from "./report-viewer";
import { saveReport, updateSavedReport } from "@/server/reports";
import {
  DATA_SOURCES,
  DATA_SOURCE_LABELS,
  DATA_SOURCE_DESCRIPTIONS,
  FIELD_DEFINITIONS,
  type DataSource,
  type ReportConfig,
  type ColumnConfig,
  type FilterConfig,
  type SortConfig,
  type GroupByConfig,
  type FilterOperator,
} from "@/lib/report-types";

const ICON_MAP: Record<string, React.ReactNode> = {
  Package: <Package className="h-5 w-5" />,
  Boxes: <Boxes className="h-5 w-5" />,
  FolderOpen: <FolderOpen className="h-5 w-5" />,
  Box: <Box className="h-5 w-5" />,
  List: <List className="h-5 w-5" />,
  Users: <Users className="h-5 w-5" />,
  MapPin: <MapPin className="h-5 w-5" />,
  Wrench: <Wrench className="h-5 w-5" />,
  ScrollText: <ScrollText className="h-5 w-5" />,
  HardHat: <HardHat className="h-5 w-5" />,
  UserCheck: <UserCheck className="h-5 w-5" />,
};

const DATA_SOURCE_ICON_MAP: Record<DataSource, string> = {
  assets: "Package",
  models: "Boxes",
  projects: "FolderOpen",
  kits: "Box",
  lineItems: "List",
  clients: "Users",
  locations: "MapPin",
  maintenance: "Wrench",
  activityLog: "ScrollText",
  crew: "HardHat",
  crewAssignments: "UserCheck",
};

const FILTER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less or equal" },
  { value: "in", label: "In list" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];

const DATE_PRESETS = [
  { value: "last7days", label: "Last 7 days" },
  { value: "last30days", label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "thisQuarter", label: "This quarter" },
  { value: "thisYear", label: "This year" },
  { value: "lastYear", label: "Last year" },
];

interface ReportBuilderProps {
  initialConfig?: ReportConfig;
  savedReportId?: string;
  savedReportName?: string;
}

export function ReportBuilder({ initialConfig, savedReportId, savedReportName }: ReportBuilderProps) {
  const router = useRouter();
  const [step, setStep] = useState<number>(initialConfig ? 2 : 1);
  const [dataSource, setDataSource] = useState<DataSource | null>(initialConfig?.dataSource ?? null);
  const [columns, setColumns] = useState<ColumnConfig[]>(initialConfig?.columns ?? []);
  const [filters, setFilters] = useState<FilterConfig[]>(initialConfig?.filters ?? []);
  const [sortBy, setSortBy] = useState<SortConfig[]>(initialConfig?.sortBy ?? []);
  const [groupBy, setGroupBy] = useState<GroupByConfig | undefined>(initialConfig?.groupBy);
  const [enableGrouping, setEnableGrouping] = useState(!!initialConfig?.groupBy);
  const [dateRange, setDateRange] = useState(initialConfig?.dateRange);
  const [limit, setLimit] = useState<number | undefined>(initialConfig?.limit);
  const [includeInactive, setIncludeInactive] = useState(initialConfig?.includeInactive ?? false);
  const [showPreview, setShowPreview] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [reportName, setReportName] = useState(savedReportName ?? "");
  const [reportDescription, setReportDescription] = useState("");
  const [isShared, setIsShared] = useState(false);

  const fields = dataSource ? FIELD_DEFINITIONS[dataSource] : [];

  const buildConfig = useCallback((): ReportConfig => ({
    dataSource: dataSource!,
    columns,
    filters,
    sortBy: sortBy.length > 0 ? sortBy : undefined,
    groupBy: enableGrouping ? groupBy : undefined,
    dateRange,
    limit,
    includeInactive,
  }), [dataSource, columns, filters, sortBy, groupBy, enableGrouping, dateRange, limit, includeInactive]);

  // Select data source
  const handleSelectDataSource = (ds: DataSource) => {
    setDataSource(ds);
    // Pre-select all core fields
    const defs = FIELD_DEFINITIONS[ds];
    setColumns(defs.map((f) => ({
      field: f.field,
      label: f.label,
      visible: f.section === "core",
    })));
    setFilters([]);
    setSortBy([]);
    setGroupBy(undefined);
    setStep(2);
  };

  // Toggle column visibility
  const toggleColumn = (field: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.field === field ? { ...c, visible: !c.visible } : c))
    );
  };

  // Add filter
  const addFilter = () => {
    if (fields.length === 0) return;
    setFilters((prev) => [
      ...prev,
      { field: fields[0].field, operator: "equals" as FilterOperator, value: "" },
    ]);
  };

  const updateFilter = (index: number, updates: Partial<FilterConfig>) => {
    setFilters((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const config = buildConfig();
      if (savedReportId) {
        return updateSavedReport(savedReportId, {
          name: reportName,
          description: reportDescription || undefined,
          config,
          isShared,
        });
      } else {
        return saveReport({
          name: reportName,
          description: reportDescription || undefined,
          dataSource: dataSource!,
          config,
          isShared,
        });
      }
    },
    onSuccess: () => {
      setSaveDialogOpen(false);
      router.push("/reports");
    },
  });

  return (
    <div className="space-y-6">
      {/* Step 1: Data Source */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Choose Data Source</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DATA_SOURCES.map((ds) => (
              <Card
                key={ds}
                className="cursor-pointer transition-colors hover:border-primary"
                onClick={() => handleSelectDataSource(ds)}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="text-muted-foreground mt-0.5">
                    {ICON_MAP[DATA_SOURCE_ICON_MAP[ds]]}
                  </div>
                  <div>
                    <p className="font-medium">{DATA_SOURCE_LABELS[ds]}</p>
                    <p className="text-sm text-muted-foreground">{DATA_SOURCE_DESCRIPTIONS[ds]}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {FIELD_DEFINITIONS[ds].length} fields
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step >= 2 && dataSource && (
        <div className="space-y-6">
          {/* Source indicator */}
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              {ICON_MAP[DATA_SOURCE_ICON_MAP[dataSource]]}
              {DATA_SOURCE_LABELS[dataSource]}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              Change
            </Button>
          </div>

          {/* Columns */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Columns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {["core", "related", "computed"].map((section) => {
                  const sectionFields = fields.filter((f) => f.section === section);
                  if (sectionFields.length === 0) return null;
                  return (
                    <div key={section}>
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">
                        {section === "core" ? "Core Fields" : section === "related" ? "Related Data" : "Computed Fields"}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {sectionFields.map((f) => {
                          const col = columns.find((c) => c.field === f.field);
                          return (
                            <label key={f.field} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={col?.visible ?? false}
                                onCheckedChange={() => toggleColumn(f.field)}
                              />
                              {f.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Filters</CardTitle>
                <Button variant="outline" size="sm" onClick={addFilter}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Filter
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {filters.length === 0 ? (
                <p className="text-sm text-muted-foreground">No filters applied. All records will be included.</p>
              ) : (
                <div className="space-y-3">
                  {filters.map((filter, i) => {
                    const fieldDef = fields.find((f) => f.field === filter.field);
                    return (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[160px]">
                          <Label className="text-xs">Field</Label>
                          <Select
                            value={filter.field}
                            onValueChange={(val) => val && updateFilter(i, { field: val })}
                          >
                            <SelectTrigger>
                              <SelectValue>{fields.find((f) => f.field === filter.field)?.label ?? filter.field}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {fields.map((f) => (
                                <SelectItem key={f.field} value={f.field}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="min-w-[140px]">
                          <Label className="text-xs">Operator</Label>
                          <Select
                            value={filter.operator}
                            onValueChange={(val) => val && updateFilter(i, { operator: val as FilterOperator })}
                          >
                            <SelectTrigger>
                              <SelectValue>{FILTER_OPERATORS.find((op) => op.value === filter.operator)?.label ?? filter.operator}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {FILTER_OPERATORS.map((op) => (
                                <SelectItem key={op.value} value={op.value}>
                                  {op.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {filter.operator !== "is_empty" && filter.operator !== "is_not_empty" && (
                          <div className="min-w-[160px] flex-1">
                            <Label className="text-xs">Value</Label>
                            {fieldDef?.enumValues ? (
                              <Select
                                value={String(filter.value)}
                                onValueChange={(val) => val && updateFilter(i, { value: val })}
                              >
                                <SelectTrigger>
                                  <SelectValue>{fieldDef.enumLabels?.[String(filter.value)] || String(filter.value)}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {fieldDef.enumValues.map((v) => (
                                    <SelectItem key={v} value={v}>
                                      {fieldDef.enumLabels?.[v] || v}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={String(filter.value ?? "")}
                                onChange={(e) => {
                                  const v = fieldDef?.type === "number" ? Number(e.target.value) || 0 : e.target.value;
                                  updateFilter(i, { value: v });
                                }}
                                type={fieldDef?.type === "number" ? "number" : fieldDef?.type === "date" ? "date" : "text"}
                              />
                            )}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => removeFilter(i)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Date Range */}
              <Separator className="my-4" />
              <div>
                <Label className="text-sm font-medium">Date Range (optional)</Label>
                <div className="flex flex-wrap items-end gap-2 mt-2">
                  <div className="min-w-[160px]">
                    <Label className="text-xs">Date Field</Label>
                    <Select
                      value={dateRange?.field ?? "__none__"}
                      onValueChange={(val) => setDateRange(val && val !== "__none__" ? { field: val, preset: dateRange?.preset } : undefined)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select...">{dateRange?.field ? (fields.find((f) => f.field === dateRange.field)?.label ?? dateRange.field) : "None"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {fields
                          .filter((f) => f.type === "date")
                          .map((f) => (
                            <SelectItem key={f.field} value={f.field}>
                              {f.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {dateRange?.field && (
                    <div className="min-w-[160px]">
                      <Label className="text-xs">Preset</Label>
                      <Select
                        value={dateRange.preset ?? "__custom__"}
                        onValueChange={(val) => setDateRange({ ...dateRange!, preset: val && val !== "__custom__" ? val : undefined })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Custom...">{dateRange?.preset ? (DATE_PRESETS.find((p) => p.value === dateRange.preset)?.label ?? dateRange.preset) : "Custom range"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom__">Custom range</SelectItem>
                          {DATE_PRESETS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {dateRange?.field && !dateRange.preset && (
                    <>
                      <div>
                        <Label className="text-xs">Start</Label>
                        <Input
                          type="date"
                          value={dateRange.start ?? ""}
                          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value || undefined })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">End</Label>
                        <Input
                          type="date"
                          value={dateRange.end ?? ""}
                          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value || undefined })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Grouping */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">Group & Aggregate</CardTitle>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={enableGrouping}
                    onCheckedChange={(checked) => {
                      setEnableGrouping(!!checked);
                      if (!checked) setGroupBy(undefined);
                    }}
                  />
                  Enable grouping
                </label>
              </div>
            </CardHeader>
            {enableGrouping && (
              <CardContent>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px]">
                    <Label className="text-xs">Group By Field</Label>
                    <Select
                      value={groupBy?.field ?? "__none__"}
                      onValueChange={(val) => {
                        if (!val || val === "__none__") return;
                        setGroupBy({
                          field: val,
                          aggregateColumns: groupBy?.aggregateColumns ?? [
                            { field: "*", function: "count", label: "Count" },
                          ],
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field...">{groupBy?.field ? (fields.find((f) => f.field === groupBy.field)?.label ?? groupBy.field) : "Select field..."}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {fields
                          .filter((f) => f.type === "string" || f.type === "enum")
                          .map((f) => (
                            <SelectItem key={f.field} value={f.field}>
                              {f.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {groupBy?.field && (
                  <div className="mt-3">
                    <Label className="text-xs">Aggregations</Label>
                    <div className="space-y-2 mt-1">
                      {(groupBy.aggregateColumns || []).map((agg, i) => (
                        <div key={i} className="flex items-end gap-2">
                          <div className="min-w-[120px]">
                            <Select
                              value={agg.function}
                              onValueChange={(val) => {
                                if (!val) return;
                                const updated = [...(groupBy.aggregateColumns || [])];
                                updated[i] = { ...updated[i], function: val as "count" | "sum" | "avg" | "min" | "max" };
                                setGroupBy({ ...groupBy, aggregateColumns: updated });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue>{{ count: "Count", sum: "Sum", avg: "Average", min: "Min", max: "Max" }[agg.function] ?? agg.function}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="count">Count</SelectItem>
                                <SelectItem value="sum">Sum</SelectItem>
                                <SelectItem value="avg">Average</SelectItem>
                                <SelectItem value="min">Min</SelectItem>
                                <SelectItem value="max">Max</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="min-w-[160px]">
                            <Select
                              value={agg.field}
                              onValueChange={(val) => {
                                if (!val) return;
                                const updated = [...(groupBy.aggregateColumns || [])];
                                updated[i] = { ...updated[i], field: val };
                                setGroupBy({ ...groupBy, aggregateColumns: updated });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue>{agg.field === "*" ? "All (count)" : (fields.find((f) => f.field === agg.field)?.label ?? agg.field)}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="*">All (count)</SelectItem>
                                {fields
                                  .filter((f) => f.type === "number")
                                  .map((f) => (
                                    <SelectItem key={f.field} value={f.field}>
                                      {f.label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1">
                            <Input
                              placeholder="Label"
                              value={agg.label ?? ""}
                              onChange={(e) => {
                                const updated = [...(groupBy.aggregateColumns || [])];
                                updated[i] = { ...updated[i], label: e.target.value || undefined };
                                setGroupBy({ ...groupBy, aggregateColumns: updated });
                              }}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const updated = (groupBy.aggregateColumns || []).filter((_, j) => j !== i);
                              setGroupBy({ ...groupBy, aggregateColumns: updated });
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setGroupBy({
                            ...groupBy,
                            aggregateColumns: [
                              ...(groupBy.aggregateColumns || []),
                              { field: "*", function: "count", label: "Count" },
                            ],
                          });
                        }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Aggregation
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Sort & Limit */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sort & Limit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px]">
                  <Label className="text-xs">Sort By</Label>
                  <Select
                    value={sortBy[0]?.field ?? "__default__"}
                    onValueChange={(val) => setSortBy(val && val !== "__default__" ? [{ field: val, direction: sortBy[0]?.direction ?? "asc" }] : [])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Default order">{sortBy[0]?.field ? (fields.find((f) => f.field === sortBy[0].field)?.label ?? sortBy[0].field) : "Default"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Default</SelectItem>
                      {fields.map((f) => (
                        <SelectItem key={f.field} value={f.field}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {sortBy.length > 0 && (
                  <div className="min-w-[120px]">
                    <Label className="text-xs">Direction</Label>
                    <Select
                      value={sortBy[0]?.direction ?? "asc"}
                      onValueChange={(val) => val && setSortBy([{ ...sortBy[0], direction: val as "asc" | "desc" }])}
                    >
                      <SelectTrigger>
                        <SelectValue>{sortBy[0]?.direction === "desc" ? "Descending" : "Ascending"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascending</SelectItem>
                        <SelectItem value="desc">Descending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="w-[120px]">
                  <Label className="text-xs">Row Limit</Label>
                  <Input
                    type="number"
                    value={limit ?? ""}
                    onChange={(e) => setLimit(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="No limit"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
                  <Checkbox
                    checked={includeInactive}
                    onCheckedChange={(checked) => setIncludeInactive(!!checked)}
                  />
                  Include inactive
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowPreview(true)}>
              Run Preview
            </Button>
            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
              <DialogTrigger render={<Button variant="outline" />}>
                <Save className="mr-1.5 h-4 w-4" />
                Save Report
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{savedReportId ? "Update Report" : "Save Report"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={reportName}
                      onChange={(e) => setReportName(e.target.value)}
                      placeholder="My Custom Report"
                    />
                  </div>
                  <div>
                    <Label>Description (optional)</Label>
                    <Input
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      placeholder="Brief description..."
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={isShared}
                      onCheckedChange={(checked) => setIsShared(!!checked)}
                    />
                    Share with all org members
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => saveMutation.mutate()}
                      disabled={!reportName || saveMutation.isPending}
                    >
                      {saveMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  {saveMutation.isError && (
                    <p className="text-sm text-destructive">
                      {(saveMutation.error as Error).message || "Failed to save"}
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Preview */}
          {showPreview && (
            <div className="mt-4">
              <Separator className="mb-4" />
              <h3 className="text-base font-semibold mb-3">Preview</h3>
              <ReportViewer config={buildConfig()} title={reportName || "preview"} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Report query engine — translates ReportConfig into Prisma queries.
 * Runs server-side only.
 */

import { prisma } from "@/lib/prisma";
import { getClientMap } from "@/lib/clients-read";
import type {
  ReportConfig,
  ReportResult,
  FilterConfig,
  DataSource,
  ColumnConfig,
  FieldDefinition,
} from "./report-types";
import { FIELD_DEFINITIONS } from "./report-types";

// ─── Prisma model name mapping ───────────────────────────────────────────────

const MODEL_MAP: Record<DataSource, string> = {
  assets: "asset",
  models: "model",
  projects: "project",
  kits: "kit",
  lineItems: "projectLineItem",
  clients: "client",
  locations: "location",
  maintenance: "maintenanceRecord",
  activityLog: "activityLog",
  crew: "crewMember",
  crewAssignments: "crewAssignment",
};

// ─── Filter translation ──────────────────────────────────────────────────────

function buildFilterCondition(filter: FilterConfig): Record<string, unknown> {
  const { field, operator, value } = filter;
  const parts = field.split(".");

  // Build nested condition for relation fields
  const buildNested = (parts: string[], condition: unknown): Record<string, unknown> => {
    if (parts.length === 1) return { [parts[0]]: condition };
    return { [parts[0]]: buildNested(parts.slice(1), condition) };
  };

  let condition: unknown;
  switch (operator) {
    case "equals":
      condition = value;
      break;
    case "not_equals":
      condition = { not: value };
      break;
    case "contains":
      condition = { contains: value, mode: "insensitive" };
      break;
    case "not_contains":
      condition = { not: { contains: value, mode: "insensitive" } };
      break;
    case "gt":
      condition = { gt: value };
      break;
    case "gte":
      condition = { gte: value };
      break;
    case "lt":
      condition = { lt: value };
      break;
    case "lte":
      condition = { lte: value };
      break;
    case "in":
      condition = { in: Array.isArray(value) ? value : [value] };
      break;
    case "not_in":
      condition = { notIn: Array.isArray(value) ? value : [value] };
      break;
    case "is_empty":
      condition = null;
      break;
    case "is_not_empty":
      condition = { not: null };
      break;
    case "between":
      if (Array.isArray(value) && value.length === 2) {
        condition = { gte: value[0], lte: value[1] };
      }
      break;
    default:
      condition = value;
  }

  return buildNested(parts, condition);
}

// ─── Select/Include builder ──────────────────────────────────────────────────

/**
 * Attach Convex clients onto report rows (clients no longer join via Prisma).
 * Handles a direct `client` relation (data source = projects) and a nested
 * `project.client` relation. Mutates rows in place; no-op when nothing needs it.
 */
async function attachClientsToRows(
  rows: Record<string, unknown>[],
  organizationId: string,
): Promise<void> {
  const needsDirect = rows.some((r) => typeof r.clientId === "string");
  const needsNested = rows.some(
    (r) => r.project && typeof (r.project as Record<string, unknown>).clientId === "string",
  );
  if (!needsDirect && !needsNested) return;

  const clientMap = await getClientMap(organizationId);
  for (const row of rows) {
    if (typeof row.clientId === "string") {
      row.client = clientMap.get(row.clientId) ?? null;
    }
    const proj = row.project as Record<string, unknown> | undefined;
    if (proj && typeof proj.clientId === "string") {
      proj.client = clientMap.get(proj.clientId) ?? null;
    }
  }
}

function buildSelectAndInclude(
  columns: ColumnConfig[],
  dataSource: DataSource,
): { select?: Record<string, unknown>; include?: Record<string, unknown> } {
  const fields = FIELD_DEFINITIONS[dataSource];
  const visibleFields = columns.filter((c) => c.visible);

  // If no columns selected, use include-based approach
  if (visibleFields.length === 0) {
    return {};
  }

  const include: Record<string, unknown> = {};
  const needsRelations = new Set<string>();

  for (const col of visibleFields) {
    const parts = col.field.split(".");
    if (parts.length > 1 && !parts[0].startsWith("_")) {
      needsRelations.add(parts[0]);
    }
  }

  // Build include for data sources that need computed fields or relations.
  // The `client` relation is NOT included from Prisma (clients live in Convex
  // now — stale Prisma rows). It's attached post-fetch by attachClientsToRows.
  for (const rel of needsRelations) {
    if (rel === "model") {
      include.model = { include: { category: true } };
    } else if (rel === "project") {
      include.project = { include: { location: true } };
    } else if (rel === "crewMember") {
      include.crewMember = true;
    } else if (rel === "crewRole") {
      include.crewRole = true;
    } else if (rel === "client") {
      // attached from Convex post-fetch, not via a Prisma join
    } else {
      include[rel] = true;
    }
  }

  // Add _count for computed fields
  const hasCountField = visibleFields.some((c) => c.field.startsWith("_count."));
  if (hasCountField) {
    include._count = { select: { assets: true } };
  }

  return Object.keys(include).length > 0 ? { include } : {};
}

// ─── Date range resolution ───────────────────────────────────────────────────

function resolveDateRange(config: ReportConfig): FilterConfig | null {
  if (!config.dateRange) return null;

  const { field, start, end, preset } = config.dateRange;
  const now = new Date();

  let rangeStart: string | undefined = start;
  let rangeEnd: string | undefined = end;

  if (preset) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (preset) {
      case "last7days":
        rangeStart = new Date(today.getTime() - 7 * 86400000).toISOString();
        rangeEnd = now.toISOString();
        break;
      case "last30days":
        rangeStart = new Date(today.getTime() - 30 * 86400000).toISOString();
        rangeEnd = now.toISOString();
        break;
      case "thisMonth":
        rangeStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
        rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59).toISOString();
        break;
      case "lastMonth": {
        const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        rangeStart = lm.toISOString();
        rangeEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59).toISOString();
        break;
      }
      case "thisQuarter": {
        const q = Math.floor(today.getMonth() / 3);
        rangeStart = new Date(today.getFullYear(), q * 3, 1).toISOString();
        rangeEnd = new Date(today.getFullYear(), q * 3 + 3, 0, 23, 59, 59).toISOString();
        break;
      }
      case "thisYear":
        rangeStart = new Date(today.getFullYear(), 0, 1).toISOString();
        rangeEnd = new Date(today.getFullYear(), 11, 31, 23, 59, 59).toISOString();
        break;
      case "lastYear":
        rangeStart = new Date(today.getFullYear() - 1, 0, 1).toISOString();
        rangeEnd = new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59).toISOString();
        break;
      case "next90days":
        rangeStart = now.toISOString();
        rangeEnd = new Date(today.getTime() + 90 * 86400000).toISOString();
        break;
    }
  }

  if (rangeStart && rangeEnd) {
    return { field, operator: "between", value: [rangeStart, rangeEnd] };
  } else if (rangeStart) {
    return { field, operator: "gte", value: rangeStart };
  } else if (rangeEnd) {
    return { field, operator: "lte", value: rangeEnd };
  }
  return null;
}

// ─── Sort builder ────────────────────────────────────────────────────────────

function buildOrderBy(config: ReportConfig): Record<string, unknown>[] {
  if (!config.sortBy?.length) return [{ createdAt: "desc" }];

  return config.sortBy.map((sort) => {
    const parts = sort.field.split(".");
    if (parts.length === 1) return { [parts[0]]: sort.direction };
    // Nested sort
    let obj: Record<string, unknown> = { [parts[parts.length - 1]]: sort.direction };
    for (let i = parts.length - 2; i >= 0; i--) {
      obj = { [parts[i]]: obj };
    }
    return obj;
  }).filter((o) => {
    // Skip computed field sorts - handle in post-processing.
    // Skip `client` sorts too: clients live in Convex, so a Prisma relation sort
    // would order by the stale `client` table. Client column VALUES are still
    // correct (attached from Convex post-fetch); only ordering by them is a no-op.
    const key = Object.keys(o)[0];
    return !key.startsWith("_") && key !== "client";
  });
}

// ─── Flatten nested row data ─────────────────────────────────────────────────

function flattenRow(row: Record<string, unknown>, columns: ColumnConfig[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const col of columns) {
    if (!col.visible) continue;
    const parts = col.field.split(".");
    let value: unknown = row;
    for (const part of parts) {
      if (value == null) break;
      value = (value as Record<string, unknown>)[part];
    }
    // Convert Decimal-like values
    if (value != null && typeof value === "object" && "toNumber" in (value as object)) {
      value = (value as { toNumber(): number }).toNumber();
    }
    flat[col.field] = value ?? null;
  }

  return flat;
}

// ─── Compute aggregations ────────────────────────────────────────────────────

function computeAggregations(
  rows: Record<string, unknown>[],
  columns: ColumnConfig[],
  fields: FieldDefinition[],
): Record<string, number> {
  const aggs: Record<string, number> = {};
  const numericFields = fields.filter((f) => f.type === "number");

  for (const col of columns) {
    if (!col.visible) continue;
    const fieldDef = numericFields.find((f) => f.field === col.field);
    if (!fieldDef) continue;

    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const val = row[col.field];
      if (val != null && typeof val === "number") {
        sum += val;
        count++;
      }
    }
    if (count > 0) {
      aggs[`sum:${col.field}`] = sum;
      aggs[`avg:${col.field}`] = sum / count;
      aggs[`count:${col.field}`] = count;
    }
  }

  aggs["totalRows"] = rows.length;
  return aggs;
}

// ─── Group By execution ──────────────────────────────────────────────────────

async function executeGroupedReport(
  config: ReportConfig,
  organizationId: string,
): Promise<ReportResult> {
  if (!config.groupBy) throw new Error("No groupBy config");

  const modelName = MODEL_MAP[config.dataSource];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelName] as {
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };

  // Build where clause
  const where: Record<string, unknown> = { organizationId };

  // Apply isTemplate filter for projects
  if (config.dataSource === "projects") {
    where.isTemplate = false;
  }

  // Apply isActive filter unless includeInactive
  if (!config.includeInactive) {
    const hasIsActive = FIELD_DEFINITIONS[config.dataSource].some(
      (f) => f.field === "isActive"
    );
    if (hasIsActive && !config.filters.some((f) => f.field === "isActive")) {
      where.isActive = true;
    }
  }

  // Apply filters
  for (const filter of config.filters) {
    if (filter.field === "isTemplate") {
      where.isTemplate = filter.value;
      continue;
    }
    const cond = buildFilterCondition(filter);
    Object.assign(where, cond);
  }

  // Apply date range
  const dateFilter = resolveDateRange(config);
  if (dateFilter) {
    Object.assign(where, buildFilterCondition(dateFilter));
  }

  // Fetch all matching rows with relations
  const { include } = buildSelectAndInclude(config.columns, config.dataSource);
  const allRows = await model.findMany({
    where,
    ...(include ? { include } : {}),
  }) as Record<string, unknown>[];
  await attachClientsToRows(allRows, organizationId);

  // Flatten all rows
  const flatRows = allRows.map((row) => flattenRow(row, config.columns));

  // Group by the specified field
  const groupField = config.groupBy.field;
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const row of flatRows) {
    const key = String(row[groupField] ?? "(No value)");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Build aggregated rows
  const resultRows: Record<string, unknown>[] = [];
  for (const [groupKey, groupRows] of groups) {
    const aggregatedRow: Record<string, unknown> = { [groupField]: groupKey };

    const aggColumns: Array<{ field: string; function: string; label?: string }> = config.groupBy!.aggregateColumns;
    for (let ai = 0; ai < aggColumns.length; ai++) {
      const aggField = aggColumns[ai].field;
      const aggFunc = aggColumns[ai].function;
      const label: string = aggColumns[ai].label || `${aggFunc}(${aggField})`;
      if (aggField === "*" && aggFunc === "count") {
        aggregatedRow[label] = groupRows.length;
      } else {
        const values = groupRows
          .map((r) => r[aggField])
          .filter((v): v is number => typeof v === "number");

        switch (aggFunc) {
          case "count":
            aggregatedRow[label] = values.length;
            break;
          case "sum":
            aggregatedRow[label] = values.reduce((a, b) => a + b, 0);
            break;
          case "avg":
            aggregatedRow[label] = values.length > 0
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0;
            break;
          case "min":
            aggregatedRow[label] = values.length > 0 ? Math.min(...values) : 0;
            break;
          case "max":
            aggregatedRow[label] = values.length > 0 ? Math.max(...values) : 0;
            break;
        }
      }
    }

    resultRows.push(aggregatedRow);
  }

  // Build columns for grouped result
  const groupedColumns: ColumnConfig[] = [
    { field: groupField, visible: true, label: config.columns.find((c) => c.field === groupField)?.label },
    ...config.groupBy.aggregateColumns.map((agg) => ({
      field: agg.label || `${agg.function}(${agg.field})`,
      visible: true,
      label: agg.label || `${agg.function}(${agg.field})`,
    })),
  ];

  // Sort grouped results
  if (config.sortBy?.length) {
    const sort = config.sortBy[0];
    resultRows.sort((a, b) => {
      const aVal = a[sort.field] ?? a[Object.keys(a)[0]];
      const bVal = b[sort.field] ?? b[Object.keys(b)[0]];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sort.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      return sort.direction === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }

  return {
    rows: resultRows,
    totalRows: resultRows.length,
    columns: groupedColumns,
    executedAt: new Date().toISOString(),
  };
}

// ─── Computed field post-processing ──────────────────────────────────────────

async function addComputedFields(
  rows: Record<string, unknown>[],
  config: ReportConfig,
  organizationId: string,
): Promise<void> {
  const computedCols = config.columns.filter((c) => c.visible && c.field.startsWith("_"));

  if (computedCols.length === 0) return;

  if (config.dataSource === "models") {
    for (const row of rows) {
      const modelId = (row as Record<string, unknown>)["id"] as string;
      if (!modelId) continue;

      const needsAvailable = computedCols.some((c) => c.field === "_availableCount");
      const needsCheckedOut = computedCols.some((c) => c.field === "_checkedOutCount");
      const needsRevenue = computedCols.some((c) => c.field === "_totalRevenue");

      if (needsAvailable || needsCheckedOut) {
        const statusCounts = await prisma.asset.groupBy({
          by: ["status"],
          where: { organizationId, modelId, isActive: true },
          _count: { status: true },
        });
        if (needsAvailable) {
          row["_availableCount"] = statusCounts.find((s) => s.status === "AVAILABLE")?._count.status ?? 0;
        }
        if (needsCheckedOut) {
          row["_checkedOutCount"] = statusCounts.find((s) => s.status === "CHECKED_OUT")?._count.status ?? 0;
        }
      }

      if (needsRevenue) {
        const result = await prisma.projectLineItem.aggregate({
          where: { organizationId, modelId },
          _sum: { lineTotal: true },
        });
        row["_totalRevenue"] = result._sum.lineTotal ? Number(result._sum.lineTotal) : 0;
      }
    }
  }

  if (config.dataSource === "clients") {
    for (const row of rows) {
      const clientId = (row as Record<string, unknown>)["id"] as string;
      if (!clientId) continue;

      const needsProjects = computedCols.some((c) => c.field === "_totalProjects");
      const needsRevenue = computedCols.some((c) => c.field === "_totalRevenue");

      if (needsProjects || needsRevenue) {
        const projects = await prisma.project.findMany({
          where: { organizationId, clientId, isTemplate: false },
          select: { total: true },
        });
        if (needsProjects) {
          row["_totalProjects"] = projects.length;
        }
        if (needsRevenue) {
          row["_totalRevenue"] = projects.reduce((sum, p) => sum + (p.total ? Number(p.total) : 0), 0);
        }
      }
    }
  }

  if (config.dataSource === "locations") {
    for (const row of rows) {
      const locationId = (row as Record<string, unknown>)["id"] as string;
      if (!locationId) continue;

      const needsAssets = computedCols.some((c) => c.field === "_assetCount");
      const needsKits = computedCols.some((c) => c.field === "_kitCount");

      if (needsAssets) {
        row["_assetCount"] = await prisma.asset.count({
          where: { organizationId, locationId, isActive: true },
        });
      }
      if (needsKits) {
        row["_kitCount"] = await prisma.kit.count({
          where: { organizationId, locationId, isActive: true },
        });
      }
    }
  }

  if (config.dataSource === "kits") {
    for (const row of rows) {
      const kitId = (row as Record<string, unknown>)["id"] as string;
      if (!kitId) continue;

      const needsSerialized = computedCols.some((c) => c.field === "_serializedItemCount");
      const needsBulk = computedCols.some((c) => c.field === "_bulkItemCount");

      if (needsSerialized) {
        row["_serializedItemCount"] = await prisma.kitSerializedItem.count({
          where: { kitId },
        });
      }
      if (needsBulk) {
        row["_bulkItemCount"] = await prisma.kitBulkItem.count({
          where: { kitId },
        });
      }
    }
  }

  if (config.dataSource === "projects") {
    for (const row of rows) {
      const projectId = (row as Record<string, unknown>)["id"] as string;
      if (!projectId) continue;

      const needsLineItems = computedCols.some((c) => c.field === "_lineItemCount");
      if (needsLineItems) {
        row["_lineItemCount"] = await prisma.projectLineItem.count({
          where: { organizationId, projectId },
        });
      }
    }
  }

  if (config.dataSource === "crew") {
    for (const row of rows) {
      const crewId = (row as Record<string, unknown>)["id"] as string;
      if (!crewId) continue;

      const needsAssignments = computedCols.some((c) => c.field === "_totalAssignments");
      if (needsAssignments) {
        row["_totalAssignments"] = await prisma.crewAssignment.count({
          where: { organizationId, crewMemberId: crewId },
        });
      }
    }
  }
}

// ─── Main execution function ─────────────────────────────────────────────────

export async function executeReport(
  config: ReportConfig,
  organizationId: string,
  page = 1,
  pageSize = 100,
): Promise<ReportResult> {
  // Grouped reports use a different path
  if (config.groupBy) {
    return executeGroupedReport(config, organizationId);
  }

  const modelName = MODEL_MAP[config.dataSource];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelName] as {
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    count: (args: Record<string, unknown>) => Promise<number>;
  };

  // Build where clause
  const where: Record<string, unknown> = { organizationId };

  // Apply isTemplate filter for projects
  if (config.dataSource === "projects") {
    where.isTemplate = false;
  }

  // Apply isActive filter unless includeInactive
  if (!config.includeInactive) {
    const hasIsActive = FIELD_DEFINITIONS[config.dataSource].some(
      (f) => f.field === "isActive"
    );
    if (hasIsActive && !config.filters.some((f) => f.field === "isActive")) {
      where.isActive = true;
    }
  }

  // Apply filters
  for (const filter of config.filters) {
    if (filter.field === "isTemplate") {
      where.isTemplate = filter.value;
      continue;
    }
    const cond = buildFilterCondition(filter);
    // Merge nested conditions carefully
    for (const [key, val] of Object.entries(cond)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val) && where[key] && typeof where[key] === "object") {
        where[key] = { ...(where[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else {
        where[key] = val;
      }
    }
  }

  // Apply date range
  const dateFilter = resolveDateRange(config);
  if (dateFilter) {
    const cond = buildFilterCondition(dateFilter);
    for (const [key, val] of Object.entries(cond)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val) && where[key] && typeof where[key] === "object") {
        where[key] = { ...(where[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else {
        where[key] = val;
      }
    }
  }

  // Build query components
  const { include } = buildSelectAndInclude(config.columns, config.dataSource);
  const orderBy = buildOrderBy(config);
  const take = config.limit || pageSize;
  const skip = (page - 1) * take;

  // Execute query
  const [rawRows, totalRows] = await Promise.all([
    model.findMany({
      where,
      ...(include ? { include } : {}),
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      take,
      skip,
    }),
    model.count({ where }),
  ]);

  const rows = rawRows as Record<string, unknown>[];
  // Clients live in Convex — attach for display (see attachClientsToRows).
  await attachClientsToRows(rows, organizationId);

  // Add computed fields
  await addComputedFields(rows, config, organizationId);

  // Flatten rows to include only visible columns
  const flatRows = rows.map((row) => flattenRow(row, config.columns));

  // Compute aggregations
  const fields = FIELD_DEFINITIONS[config.dataSource];
  const aggregations = computeAggregations(flatRows, config.columns, fields);

  return {
    rows: flatRows,
    totalRows,
    columns: config.columns.filter((c) => c.visible),
    aggregations,
    executedAt: new Date().toISOString(),
  };
}

// ─── CSV generation ──────────────────────────────────────────────────────────

export function generateCSV(result: ReportResult): string {
  const cols = result.columns.filter((c) => c.visible);
  const fields = FIELD_DEFINITIONS;

  // Header row
  const headers = cols.map((c) => {
    const label = c.label || c.field;
    // Escape quotes in CSV
    return `"${label.replace(/"/g, '""')}"`;
  });

  // Data rows
  const dataRows = result.rows.map((row) => {
    return cols.map((c) => {
      let val = row[c.field];
      if (val == null) return '""';
      if (val instanceof Date) {
        val = (val as Date).toISOString().split("T")[0];
      }
      if (typeof val === "number") {
        return String(val);
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    });
  });

  return [headers.join(","), ...dataRows.map((r) => r.join(","))].join("\n");
}

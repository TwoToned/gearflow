import { z } from "zod";
import { DATA_SOURCES } from "@/lib/report-types";

export const filterOperators = [
  "equals", "not_equals", "contains", "not_contains",
  "gt", "gte", "lt", "lte",
  "in", "not_in", "is_empty", "is_not_empty", "between",
] as const;

export const aggregateFunctions = ["count", "sum", "avg", "min", "max"] as const;

const columnConfigSchema = z.object({
  field: z.string().min(1),
  label: z.string().optional(),
  visible: z.boolean(),
  width: z.number().optional(),
});

const filterConfigSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(filterOperators),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.tuple([z.string(), z.string()]),
  ]),
});

const groupByConfigSchema = z.object({
  field: z.string().min(1),
  aggregateColumns: z.array(z.object({
    field: z.string().min(1),
    function: z.enum(aggregateFunctions),
    label: z.string().optional(),
  })),
});

const sortConfigSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});

const dateRangeConfigSchema = z.object({
  field: z.string().min(1),
  start: z.string().optional(),
  end: z.string().optional(),
  preset: z.string().optional(),
});

export const reportConfigSchema = z.object({
  dataSource: z.enum(DATA_SOURCES),
  columns: z.array(columnConfigSchema),
  filters: z.array(filterConfigSchema),
  groupBy: groupByConfigSchema.optional(),
  sortBy: z.array(sortConfigSchema).optional(),
  dateRange: dateRangeConfigSchema.optional(),
  limit: z.number().int().positive().max(10000).optional(),
  includeInactive: z.boolean().optional(),
});

export const saveReportSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  dataSource: z.enum(DATA_SOURCES),
  config: reportConfigSchema,
  isShared: z.boolean().default(false),
  isPinned: z.boolean().default(false),
});

export const updateReportSchema = saveReportSchema.partial();

export type SaveReportInput = z.input<typeof saveReportSchema>;
export type UpdateReportInput = z.input<typeof updateReportSchema>;

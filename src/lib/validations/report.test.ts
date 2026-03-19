import { describe, it, expect } from "vitest";
import {
  reportConfigSchema,
  saveReportSchema,
  updateReportSchema,
  filterOperators,
  aggregateFunctions,
} from "./report";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const minimalColumn = { field: "name", visible: true };
const minimalFilter = { field: "status", operator: "equals" as const, value: "active" };

const minimalReportConfig = {
  dataSource: "assets" as const,
  columns: [minimalColumn],
  filters: [],
};

const fullReportConfig = {
  dataSource: "projects" as const,
  columns: [
    { field: "name", label: "Project Name", visible: true, width: 200 },
    { field: "status", visible: false },
  ],
  filters: [
    { field: "status", operator: "equals" as const, value: "ACTIVE" },
    { field: "budget", operator: "gt" as const, value: 1000 },
    { field: "tags", operator: "in" as const, value: ["vip", "urgent"] },
    { field: "dates", operator: "between" as const, value: ["2024-01-01", "2024-12-31"] as [string, string] },
    { field: "archived", operator: "equals" as const, value: false },
  ],
  groupBy: {
    field: "status",
    aggregateColumns: [
      { field: "budget", function: "sum" as const, label: "Total Budget" },
      { field: "id", function: "count" as const },
    ],
  },
  sortBy: [
    { field: "name", direction: "asc" as const },
    { field: "createdAt", direction: "desc" as const },
  ],
  dateRange: {
    field: "createdAt",
    start: "2024-01-01",
    end: "2024-12-31",
    preset: "this_year",
  },
  limit: 500,
  includeInactive: true,
};

// ---------------------------------------------------------------------------
// reportConfigSchema
// ---------------------------------------------------------------------------
describe("reportConfigSchema", () => {
  it("accepts valid minimal config", () => {
    expect(reportConfigSchema.safeParse(minimalReportConfig).success).toBe(true);
  });

  it("accepts valid complete config", () => {
    expect(reportConfigSchema.safeParse(fullReportConfig).success).toBe(true);
  });

  // --- dataSource enum ---
  it("accepts all valid data sources", () => {
    const sources = [
      "assets", "models", "projects", "kits", "lineItems",
      "clients", "locations", "maintenance", "activityLog",
      "crew", "crewAssignments",
    ];
    for (const ds of sources) {
      const result = reportConfigSchema.safeParse({ ...minimalReportConfig, dataSource: ds });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid dataSource", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, dataSource: "users" }).success).toBe(false);
  });

  it("rejects missing dataSource", () => {
    const { dataSource: _, ...data } = minimalReportConfig;
    expect(reportConfigSchema.safeParse(data).success).toBe(false);
  });

  // --- columns ---
  it("rejects missing columns", () => {
    const { columns: _, ...data } = minimalReportConfig;
    expect(reportConfigSchema.safeParse(data).success).toBe(false);
  });

  it("accepts empty columns array", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, columns: [] }).success).toBe(true);
  });

  it("rejects column with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      columns: [{ field: "", visible: true }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects column missing visible", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      columns: [{ field: "name" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts column with optional label and width", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      columns: [{ field: "name", label: "Name", visible: true, width: 150 }],
    });
    expect(result.success).toBe(true);
  });

  // --- filters ---
  it("accepts empty filters array", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, filters: [] }).success).toBe(true);
  });

  it("rejects filter with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "", operator: "equals", value: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects filter with invalid operator", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "status", operator: "starts_with", value: "a" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid filter operators", () => {
    for (const op of filterOperators) {
      const result = reportConfigSchema.safeParse({
        ...minimalReportConfig,
        filters: [{ field: "f", operator: op, value: "v" }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts string filter value", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "name", operator: "contains", value: "test" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts number filter value", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "qty", operator: "gt", value: 42 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts boolean filter value", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "active", operator: "equals", value: true }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts string array filter value (for 'in' operator)", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "status", operator: "in", value: ["A", "B", "C"] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts tuple filter value (for 'between' operator)", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "date", operator: "between", value: ["2024-01-01", "2024-12-31"] }],
    });
    expect(result.success).toBe(true);
  });

  // --- groupBy ---
  it("accepts config without groupBy", () => {
    const result = reportConfigSchema.safeParse(minimalReportConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupBy).toBeUndefined();
    }
  });

  it("accepts valid groupBy", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: {
        field: "category",
        aggregateColumns: [{ field: "price", function: "sum" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects groupBy with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: { field: "", aggregateColumns: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects aggregate column with invalid function", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: {
        field: "cat",
        aggregateColumns: [{ field: "price", function: "median" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid aggregate functions", () => {
    for (const fn of aggregateFunctions) {
      const result = reportConfigSchema.safeParse({
        ...minimalReportConfig,
        groupBy: {
          field: "cat",
          aggregateColumns: [{ field: "val", function: fn }],
        },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects aggregate column with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: {
        field: "cat",
        aggregateColumns: [{ field: "", function: "count" }],
      },
    });
    expect(result.success).toBe(false);
  });

  // --- sortBy ---
  it("accepts config without sortBy", () => {
    const result = reportConfigSchema.safeParse(minimalReportConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortBy).toBeUndefined();
    }
  });

  it("accepts valid sortBy", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      sortBy: [{ field: "name", direction: "asc" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects sortBy with invalid direction", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      sortBy: [{ field: "name", direction: "ascending" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects sortBy with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      sortBy: [{ field: "", direction: "asc" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts both asc and desc directions", () => {
    for (const dir of ["asc", "desc"]) {
      const result = reportConfigSchema.safeParse({
        ...minimalReportConfig,
        sortBy: [{ field: "name", direction: dir }],
      });
      expect(result.success).toBe(true);
    }
  });

  // --- dateRange ---
  it("accepts config without dateRange", () => {
    const result = reportConfigSchema.safeParse(minimalReportConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateRange).toBeUndefined();
    }
  });

  it("accepts valid dateRange with start and end", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      dateRange: { field: "createdAt", start: "2024-01-01", end: "2024-12-31" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts dateRange with only preset", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      dateRange: { field: "createdAt", preset: "last_30_days" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts dateRange with only field (all optional sub-fields omitted)", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      dateRange: { field: "updatedAt" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects dateRange with empty field", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      dateRange: { field: "" },
    });
    expect(result.success).toBe(false);
  });

  // --- limit ---
  it("accepts config without limit", () => {
    const parsed = reportConfigSchema.parse(minimalReportConfig);
    expect(parsed.limit).toBeUndefined();
  });

  it("accepts valid limit", () => {
    const result = reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 100 });
    expect(result.success).toBe(true);
  });

  it("rejects limit of 0", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 0 }).success).toBe(false);
  });

  it("rejects negative limit", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: -1 }).success).toBe(false);
  });

  it("rejects limit above 10000", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 10001 }).success).toBe(false);
  });

  it("accepts limit at boundary 10000", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 10000 }).success).toBe(true);
  });

  it("accepts limit at boundary 1", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 1 }).success).toBe(true);
  });

  it("rejects non-integer limit", () => {
    expect(reportConfigSchema.safeParse({ ...minimalReportConfig, limit: 50.5 }).success).toBe(false);
  });

  // --- includeInactive ---
  it("accepts includeInactive as boolean", () => {
    const result = reportConfigSchema.safeParse({ ...minimalReportConfig, includeInactive: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeInactive).toBe(true);
    }
  });

  it("accepts omitted includeInactive", () => {
    const parsed = reportConfigSchema.parse(minimalReportConfig);
    expect(parsed.includeInactive).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// saveReportSchema
// ---------------------------------------------------------------------------
describe("saveReportSchema", () => {
  const validMinimal = {
    name: "My Report",
    dataSource: "assets" as const,
    config: minimalReportConfig,
  };

  const validComplete = {
    name: "Asset Inventory Report",
    description: "Shows all active assets grouped by category",
    dataSource: "assets" as const,
    config: fullReportConfig,
    isShared: true,
    isPinned: true,
  };

  it("accepts valid minimal data", () => {
    expect(saveReportSchema.safeParse(validMinimal).success).toBe(true);
  });

  it("accepts valid complete data", () => {
    expect(saveReportSchema.safeParse(validComplete).success).toBe(true);
  });

  // --- defaults ---
  it("applies default isShared false", () => {
    const parsed = saveReportSchema.parse(validMinimal);
    expect(parsed.isShared).toBe(false);
  });

  it("applies default isPinned false", () => {
    const parsed = saveReportSchema.parse(validMinimal);
    expect(parsed.isPinned).toBe(false);
  });

  // --- required fields ---
  it("rejects missing name", () => {
    const { name: _, ...data } = validMinimal;
    expect(saveReportSchema.safeParse(data).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, name: "" }).success).toBe(false);
  });

  it("rejects missing dataSource", () => {
    const { dataSource: _, ...data } = validMinimal;
    expect(saveReportSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing config", () => {
    const { config: _, ...data } = validMinimal;
    expect(saveReportSchema.safeParse(data).success).toBe(false);
  });

  // --- max length ---
  it("rejects name longer than 100 chars", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, name: "x".repeat(101) }).success).toBe(false);
  });

  it("accepts name at exactly 100 chars", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, name: "x".repeat(100) }).success).toBe(true);
  });

  it("rejects description longer than 500 chars", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, description: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts description at exactly 500 chars", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, description: "x".repeat(500) }).success).toBe(true);
  });

  // --- optional fields ---
  it("allows omitting description", () => {
    const parsed = saveReportSchema.parse(validMinimal);
    expect(parsed.description).toBeUndefined();
  });

  // --- nested config validation ---
  it("rejects invalid nested config (missing dataSource in config)", () => {
    const result = saveReportSchema.safeParse({
      ...validMinimal,
      config: { columns: [], filters: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested config (invalid dataSource in config)", () => {
    const result = saveReportSchema.safeParse({
      ...validMinimal,
      config: { dataSource: "invalid", columns: [], filters: [] },
    });
    expect(result.success).toBe(false);
  });

  // --- enum validation ---
  it("rejects invalid dataSource", () => {
    expect(saveReportSchema.safeParse({ ...validMinimal, dataSource: "users" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateReportSchema (partial of saveReportSchema)
// ---------------------------------------------------------------------------
describe("updateReportSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    expect(updateReportSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial update with only name", () => {
    const result = updateReportSchema.safeParse({ name: "Updated Name" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Updated Name");
    }
  });

  it("accepts partial update with only description", () => {
    const result = updateReportSchema.safeParse({ description: "New desc" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with only isShared", () => {
    const result = updateReportSchema.safeParse({ isShared: true });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with only isPinned", () => {
    const result = updateReportSchema.safeParse({ isPinned: true });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with only config", () => {
    const result = updateReportSchema.safeParse({ config: minimalReportConfig });
    expect(result.success).toBe(true);
  });

  it("still validates constraints on provided fields (name too long)", () => {
    expect(updateReportSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });

  it("still validates constraints on provided fields (empty name)", () => {
    expect(updateReportSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("still validates constraints on provided fields (invalid dataSource)", () => {
    expect(updateReportSchema.safeParse({ dataSource: "users" }).success).toBe(false);
  });

  it("still validates nested config when provided", () => {
    const result = updateReportSchema.safeParse({
      config: { columns: [], filters: [] },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it("filter value rejects object (not in union)", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "x", operator: "equals", value: { nested: true } }],
    });
    expect(result.success).toBe(false);
  });

  it("filter value rejects null", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [{ field: "x", operator: "equals", value: null }],
    });
    expect(result.success).toBe(false);
  });

  it("multiple filters are accepted", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      filters: [
        { field: "a", operator: "equals", value: "1" },
        { field: "b", operator: "gt", value: 10 },
        { field: "c", operator: "is_empty", value: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("multiple sort entries are accepted", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      sortBy: [
        { field: "a", direction: "asc" },
        { field: "b", direction: "desc" },
        { field: "c", direction: "asc" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("groupBy with empty aggregateColumns is accepted", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: { field: "status", aggregateColumns: [] },
    });
    expect(result.success).toBe(true);
  });

  it("aggregate column with optional label", () => {
    const result = reportConfigSchema.safeParse({
      ...minimalReportConfig,
      groupBy: {
        field: "status",
        aggregateColumns: [
          { field: "price", function: "sum", label: "Total Price" },
          { field: "qty", function: "count" },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

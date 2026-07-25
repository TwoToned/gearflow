/**
 * Shared table utilities for server-side filtering and sorting.
 * Used by server actions to translate DataTable filter state into Prisma queries.
 */

export type FilterType = "enum" | "text" | "date" | "number" | "boolean";

export type FilterValue =
  | string[]                        // enum: selected values
  | string                          // text: search string
  | { from?: string; to?: string }  // date: range
  | { min?: number; max?: number }  // number: range
  | boolean;                        // boolean

export interface FilterColumnDef {
  id: string;
  filterType?: FilterType;
  filterKey?: string; // server-side field path (defaults to id)
}

/**
 * Translates a Record<string, FilterValue> into a Prisma-compatible `where` clause.
 * Supports nested dot-path keys like "model.categoryId".
 */
export function buildFilterWhere(
  filters: Record<string, FilterValue> | undefined,
  columnDefs: FilterColumnDef[],
): Record<string, unknown> {
  if (!filters) return {};

  const where: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    const col = columnDefs.find((c) => c.id === key);
    if (!col) continue;

    const fieldPath = col.filterKey || col.id;

    switch (col.filterType) {
      case "enum":
        if (Array.isArray(value) && value.length > 0) {
          setNestedWhere(where, fieldPath, { in: value });
        }
        break;
      case "text":
        if (typeof value === "string" && value.length > 0) {
          setNestedWhere(where, fieldPath, { contains: value, mode: "insensitive" });
        }
        break;
      case "date":
        if (typeof value === "object" && !Array.isArray(value) && ("from" in value || "to" in value)) {
          const dateFilter: Record<string, Date> = {};
          const dv = value as { from?: string; to?: string };
          if (dv.from) dateFilter.gte = new Date(dv.from);
          if (dv.to) dateFilter.lte = new Date(dv.to + "T23:59:59.999Z");
          if (Object.keys(dateFilter).length > 0) {
            setNestedWhere(where, fieldPath, dateFilter);
          }
        }
        break;
      case "number":
        if (typeof value === "object" && !Array.isArray(value) && ("min" in value || "max" in value)) {
          const numFilter: Record<string, number> = {};
          const nv = value as { min?: number; max?: number };
          if (nv.min != null) numFilter.gte = nv.min;
          if (nv.max != null) numFilter.lte = nv.max;
          if (Object.keys(numFilter).length > 0) {
            setNestedWhere(where, fieldPath, numFilter);
          }
        }
        break;
      case "boolean":
        if (typeof value === "boolean") {
          setNestedWhere(where, fieldPath, value);
        }
        break;
    }
  }

  return where;
}

/**
 * Sets a nested value in a where clause. Handles dot-paths like "model.categoryId".
 */
function setNestedWhere(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  if (parts.length === 1) {
    if (path === "__proto__" || path === "constructor" || path === "prototype") return;
    obj[path] = value;
    return;
  }

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === "__proto__" || part === "constructor" || part === "prototype") return;
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  if (lastKey === "__proto__" || lastKey === "constructor" || lastKey === "prototype") return;
  current[lastKey] = value;
}

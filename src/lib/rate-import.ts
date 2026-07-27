/**
 * Pure helpers for the model-rate CSV import (consumed by
 * `src/server/csv.ts` → `importModelRatesCSV`). Kept out of the `"use server"`
 * module so they can be unit-tested without a database.
 *
 * The rate import is deliberately narrow: it matches existing models by an
 * identifier column (id / sku / modelNumber / name) and updates only the
 * pricing-optimizer rate fields. It NEVER creates models — that's what the
 * full `importModelsCSV` is for. This makes it safe to feed a hand-made
 * "rate sheet" that only carries names + rates without risking duplicate
 * empty models.
 */

// WS11 (#950) — `salePrice` rides the same narrow rate-import lane as the
// rental rates (match by identifier, update one field, never create models).
export const RATE_FIELDS = ["dailyRate", "weeklyRate", "monthlyRate", "salePrice"] as const;
export type RateField = (typeof RATE_FIELDS)[number];

/** Normalize a header/identifier for tolerant matching (case + spacing + punctuation). */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s_#-]/g, "");
}

/** Accepted header aliases per rate column (already normalized via {@link normalizeKey}). */
const RATE_ALIASES: Record<RateField, string[]> = {
  dailyRate: ["dailyrate", "daily", "dayrate", "perday"],
  weeklyRate: ["weeklyrate", "weekly", "weekrate", "perweek"],
  monthlyRate: ["monthlyrate", "monthly", "monthrate", "permonth"],
  salePrice: ["saleprice", "sale", "sellprice", "rrp", "retail"],
};

/** Accepted header aliases per identifier column (normalized). Order = match priority. */
const IDENTIFIER_ALIASES = {
  id: ["id", "modelid"],
  sku: ["sku"],
  modelNumber: ["modelnumber", "modelno", "modelnum"],
  name: ["name", "model", "modelname"],
} as const;

export interface RowIdentifier {
  id?: string;
  sku?: string;
  modelNumber?: string;
  name?: string;
}

export interface ParsedRateRow {
  identifier: RowIdentifier;
  rates: Partial<Record<RateField, number>>;
  errors: string[];
  /** true when at least one rate column carried a value (valid or not). */
  hasRate: boolean;
}

/** Parse a single non-negative money value. Empty → no value; bad/negative → error. */
export function parseRateValue(raw: string): { value?: number; error?: string } {
  const t = raw.trim();
  if (!t) return {};
  const n = Number(t.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return { error: `"${raw}" is not a number` };
  if (n < 0) return { error: `rate cannot be negative ("${raw}")` };
  return { value: Math.round(n * 100) / 100 };
}

/**
 * Parse one CSV row (given as a normalized-header → raw-value map) into an
 * identifier + rate updates. Collects per-cell parse errors rather than throwing.
 */
export function parseRateRow(cells: Map<string, string>): ParsedRateRow {
  const get = (aliases: readonly string[]) => {
    for (const a of aliases) {
      const v = cells.get(a);
      if (v !== undefined && v.trim() !== "") return v.trim();
    }
    return "";
  };

  const identifier: RowIdentifier = {
    id: get(IDENTIFIER_ALIASES.id) || undefined,
    sku: get(IDENTIFIER_ALIASES.sku) || undefined,
    modelNumber: get(IDENTIFIER_ALIASES.modelNumber) || undefined,
    name: get(IDENTIFIER_ALIASES.name) || undefined,
  };

  const rates: Partial<Record<RateField, number>> = {};
  const errors: string[] = [];
  let hasRate = false;

  for (const field of RATE_FIELDS) {
    const raw = get(RATE_ALIASES[field]);
    if (raw === "") continue;
    hasRate = true;
    const { value, error } = parseRateValue(raw);
    if (error) errors.push(`${field}: ${error}`);
    else if (value !== undefined) rates[field] = value;
  }

  return { identifier, rates, errors, hasRate };
}

export interface ModelIndexEntry {
  id: string;
  name: string;
  sku: string | null;
  modelNumber: string | null;
}

export interface ModelIndex {
  byId: Set<string>;
  bySku: Map<string, string[]>;
  byNumber: Map<string, string[]>;
  byName: Map<string, string[]>;
}

function pushIndex(map: Map<string, string[]>, key: string, id: string) {
  const norm = key.trim().toLowerCase();
  if (!norm) return;
  const existing = map.get(norm);
  if (existing) existing.push(id);
  else map.set(norm, [id]);
}

/** Build lookup maps for tolerant identifier matching. Names/SKUs may collide. */
export function buildModelIndex(models: ModelIndexEntry[]): ModelIndex {
  const index: ModelIndex = {
    byId: new Set(),
    bySku: new Map(),
    byNumber: new Map(),
    byName: new Map(),
  };
  for (const m of models) {
    index.byId.add(m.id);
    if (m.sku) pushIndex(index.bySku, m.sku, m.id);
    if (m.modelNumber) pushIndex(index.byNumber, m.modelNumber, m.id);
    pushIndex(index.byName, m.name, m.id);
  }
  return index;
}

export interface ModelMatch {
  modelId?: string;
  error?: string;
}

/** Resolve a row identifier to a single model id, in priority order id → sku → modelNumber → name. */
export function matchModel(identifier: RowIdentifier, index: ModelIndex): ModelMatch {
  if (identifier.id) {
    return index.byId.has(identifier.id)
      ? { modelId: identifier.id }
      : { error: `Model id "${identifier.id}" not found` };
  }
  const tryMap = (
    value: string | undefined,
    map: Map<string, string[]>,
    label: string,
  ): ModelMatch | null => {
    if (!value) return null;
    const ids = map.get(value.trim().toLowerCase()) ?? [];
    if (ids.length === 0) return { error: `${label} "${value}" not found` };
    if (ids.length > 1) return { error: `${label} "${value}" matches ${ids.length} models — use sku or id` };
    return { modelId: ids[0] };
  };

  return (
    tryMap(identifier.sku, index.bySku, "SKU") ??
    tryMap(identifier.modelNumber, index.byNumber, "Model number") ??
    tryMap(identifier.name, index.byName, "Model") ?? {
      error: "No model identifier (name, modelNumber, sku, or id)",
    }
  );
}

/** True if the header row carries at least one rate column. */
export function hasRateColumn(normalizedHeaders: string[]): boolean {
  const set = new Set(normalizedHeaders);
  return RATE_FIELDS.some((f) => RATE_ALIASES[f].some((a) => set.has(a)));
}

/** True if the header row carries at least one identifier column. */
export function hasIdentifierColumn(normalizedHeaders: string[]): boolean {
  const set = new Set(normalizedHeaders);
  return Object.values(IDENTIFIER_ALIASES).some((aliases) => aliases.some((a) => set.has(a)));
}

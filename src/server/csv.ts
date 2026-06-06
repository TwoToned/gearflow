"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext, requirePermission } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import {
  buildModelIndex,
  hasIdentifierColumn,
  hasRateColumn,
  matchModel,
  normalizeKey,
  parseRateRow,
  type ModelIndexEntry,
} from "@/lib/rate-import";

// ─── EXPORT ─────────────────────────────────────────────────────────────────

export async function exportModelsCSV() {
  const { organizationId } = await getOrgContext();

  const models = await prisma.model.findMany({
    where: { organizationId, isActive: true },
    include: { category: true },
    orderBy: { name: "asc" },
  });

  const headers = [
    "name",
    "manufacturer",
    "modelNumber",
    "sku",
    "category",
    "assetType",
    "description",
    "defaultRentalPrice",
    "dailyRate",
    "weeklyRate",
    "monthlyRate",
    "defaultPurchasePrice",
    "replacementCost",
    "weight",
    "powerDraw",
    "requiresTestAndTag",
    "testAndTagIntervalDays",
    "maintenanceIntervalDays",
    "tags",
  ];

  const rows = models.map((m) => [
    m.name,
    m.manufacturer || "",
    m.modelNumber || "",
    m.sku || "",
    m.category?.name || "",
    m.assetType,
    m.description || "",
    m.defaultRentalPrice?.toString() || "",
    m.dailyRate?.toString() || "",
    m.weeklyRate?.toString() || "",
    m.monthlyRate?.toString() || "",
    m.defaultPurchasePrice?.toString() || "",
    m.replacementCost?.toString() || "",
    m.weight?.toString() || "",
    m.powerDraw?.toString() || "",
    m.requiresTestAndTag ? "true" : "false",
    m.testAndTagIntervalDays?.toString() || "",
    m.maintenanceIntervalDays?.toString() || "",
    m.tags?.join(";") || "",
  ]);

  return escapeCSV(headers, rows);
}

export async function exportAssetsCSV() {
  const { organizationId } = await getOrgContext();

  const assets = await prisma.asset.findMany({
    where: { organizationId, isActive: true },
    include: {
      model: { include: { category: true } },
      location: true,
      supplier: true,
    },
    orderBy: { assetTag: "asc" },
  });

  const headers = [
    "assetTag",
    "modelName",
    "modelNumber",
    "category",
    "serialNumber",
    "customName",
    "status",
    "condition",
    "locationName",
    "purchaseDate",
    "purchasePrice",
    "supplierName",
    "warrantyExpiry",
    "notes",
    "tags",
  ];

  const rows = assets.map((a) => [
    a.assetTag,
    a.model.name,
    a.model.modelNumber || "",
    a.model.category?.name || "",
    a.serialNumber || "",
    a.customName || "",
    a.status,
    a.condition,
    a.location?.name || "",
    a.purchaseDate ? a.purchaseDate.toISOString().split("T")[0] : "",
    a.purchasePrice?.toString() || "",
    a.supplier?.name || "",
    a.warrantyExpiry ? a.warrantyExpiry.toISOString().split("T")[0] : "",
    a.notes || "",
    a.tags?.join(";") || "",
  ]);

  return escapeCSV(headers, rows);
}

export async function exportBulkAssetsCSV() {
  const { organizationId } = await getOrgContext();

  const bulkAssets = await prisma.bulkAsset.findMany({
    where: { organizationId, isActive: true },
    include: {
      model: { include: { category: true } },
      location: true,
    },
    orderBy: { assetTag: "asc" },
  });

  const headers = [
    "assetTag",
    "modelName",
    "modelNumber",
    "category",
    "totalQuantity",
    "availableQuantity",
    "status",
    "purchasePricePerUnit",
    "reorderThreshold",
    "locationName",
    "notes",
    "tags",
  ];

  const rows = bulkAssets.map((ba) => [
    ba.assetTag,
    ba.model.name,
    ba.model.modelNumber || "",
    ba.model.category?.name || "",
    ba.totalQuantity.toString(),
    ba.availableQuantity.toString(),
    ba.status,
    ba.purchasePricePerUnit?.toString() || "",
    ba.reorderThreshold?.toString() || "",
    ba.location?.name || "",
    ba.notes || "",
    ba.tags?.join(";") || "",
  ]);

  return escapeCSV(headers, rows);
}

// ─── IMPORT ─────────────────────────────────────────────────────────────────

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export async function importModelsCSV(csvContent: string): Promise<ImportResult> {
  const { organizationId } = await requirePermission("model", "import");
  const rows = parseCSV(csvContent);
  if (rows.length === 0) throw new Error("CSV is empty");

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) throw new Error('CSV must have a "name" column');

  // Preload categories for lookup
  const categories = await prisma.category.findMany({ where: { organizationId } });
  const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    try {
      const get = (col: string) => {
        const idx = headers.indexOf(col.toLowerCase());
        return idx >= 0 && idx < row.length ? row[idx].trim() : "";
      };

      const name = get("name");
      if (!name) {
        result.errors.push({ row: i + 1, message: "Missing name" });
        continue;
      }

      const categoryName = get("category");
      const categoryId = categoryName ? categoryMap.get(categoryName.toLowerCase()) || null : null;

      const assetTypeRaw = get("assettype") || get("asset_type") || get("type");
      const assetType = assetTypeRaw.toUpperCase() === "BULK" ? "BULK" : "SERIALIZED";

      const dailyRate = parseDecimal(get("dailyrate") || get("daily_rate") || get("daily"));
      const weeklyRate = parseDecimal(get("weeklyrate") || get("weekly_rate") || get("weekly"));
      const monthlyRate = parseDecimal(get("monthlyrate") || get("monthly_rate") || get("monthly"));
      const explicitRentalPrice = parseDecimal(get("defaultrentalprice") || get("rental_price") || get("rentalprice"));

      // Reject negative rates so a CSV can't persist invalid optimizer pricing
      // (mirrors the model form + the rates-only import).
      const negativeRate = (
        [
          ["dailyRate", dailyRate],
          ["weeklyRate", weeklyRate],
          ["monthlyRate", monthlyRate],
          ["defaultRentalPrice", explicitRentalPrice],
        ] as const
      ).find(([, v]) => v !== null && v < 0);
      if (negativeRate) {
        result.errors.push({ row: i + 1, message: `${negativeRate[0]} cannot be negative` });
        continue;
      }

      const data = {
        name,
        manufacturer: get("manufacturer") || null,
        modelNumber: get("modelnumber") || get("model_number") || null,
        sku: get("sku") || null,
        categoryId,
        description: get("description") || null,
        assetType: assetType as "SERIALIZED" | "BULK",
        // Keep defaultRentalPrice (used by quoting fallback) in sync with the daily rate.
        defaultRentalPrice: explicitRentalPrice ?? dailyRate,
        dailyRate,
        weeklyRate,
        monthlyRate,
        defaultPurchasePrice: parseDecimal(get("defaultpurchaseprice") || get("purchase_price") || get("purchaseprice")),
        replacementCost: parseDecimal(get("replacementcost") || get("replacement_cost")),
        weight: parseDecimal(get("weight")),
        powerDraw: parseInt(get("powerdraw") || get("power_draw")) || null,
        requiresTestAndTag: get("requirestestandtag") === "true",
        testAndTagIntervalDays: parseInt(get("testandtagintervaldays")) || null,
        maintenanceIntervalDays: parseInt(get("maintenanceintervaldays")) || null,
        tags: parseTags(get("tags")),
      };

      // Check if model already exists by name + manufacturer + modelNumber
      const existing = await prisma.model.findFirst({
        where: {
          organizationId,
          name: data.name,
          manufacturer: data.manufacturer,
          modelNumber: data.modelNumber,
        },
      });

      if (existing) {
        await prisma.model.update({
          where: { id: existing.id },
          data: {
            categoryId: data.categoryId ?? existing.categoryId,
            sku: data.sku ?? existing.sku,
            description: data.description ?? existing.description,
            assetType: data.assetType,
            defaultRentalPrice: data.defaultRentalPrice ?? existing.defaultRentalPrice,
            dailyRate: data.dailyRate ?? existing.dailyRate,
            weeklyRate: data.weeklyRate ?? existing.weeklyRate,
            monthlyRate: data.monthlyRate ?? existing.monthlyRate,
            defaultPurchasePrice: data.defaultPurchasePrice ?? existing.defaultPurchasePrice,
            replacementCost: data.replacementCost ?? existing.replacementCost,
            weight: data.weight ?? existing.weight,
            powerDraw: data.powerDraw ?? existing.powerDraw,
            requiresTestAndTag: data.requiresTestAndTag,
            testAndTagIntervalDays: data.testAndTagIntervalDays ?? existing.testAndTagIntervalDays,
            maintenanceIntervalDays: data.maintenanceIntervalDays ?? existing.maintenanceIntervalDays,
            ...(data.tags.length > 0 ? { tags: data.tags } : {}),
          },
        });
        result.updated++;
      } else {
        await prisma.model.create({
          data: {
            organizationId,
            ...data,
          },
        });
        result.created++;
      }
    } catch (e) {
      result.errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  return serialize(result) as ImportResult;
}

export async function importAssetsCSV(csvContent: string): Promise<ImportResult> {
  const { organizationId } = await requirePermission("asset", "import");
  const rows = parseCSV(csvContent);
  if (rows.length === 0) throw new Error("CSV is empty");

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const tagIdx = headers.indexOf("assettag") !== -1 ? headers.indexOf("assettag") : headers.indexOf("asset_tag");
  const modelIdx = headers.indexOf("modelname") !== -1 ? headers.indexOf("modelname") : headers.indexOf("model_name");
  if (modelIdx === -1) throw new Error('CSV must have a "modelName" column');

  // Preload models and locations
  const models = await prisma.model.findMany({ where: { organizationId, isActive: true } });
  const modelByName = new Map<string, typeof models[0]>();
  for (const m of models) {
    modelByName.set(m.name.toLowerCase(), m);
    if (m.modelNumber) modelByName.set(m.modelNumber.toLowerCase(), m);
  }

  const locations = await prisma.location.findMany({ where: { organizationId } });
  const locationMap = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));

  const suppliers = await prisma.supplier.findMany({ where: { organizationId } });
  const supplierMap = new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id]));

  // Get next asset tag counter for auto-assignment
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try { orgSettings = JSON.parse(org.metadata); } catch { /* ignore */ }
  }
  const prefix = (orgSettings.assetTagPrefix as string) || "AST";
  const digits = (orgSettings.assetTagDigits as number) || 5;
  let counter = (orgSettings.assetTagCounter as number) || 1;

  function nextTag() {
    const tag = `${prefix}${String(counter).padStart(digits, "0")}`;
    counter++;
    return tag;
  }

  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    try {
      const get = (col: string) => {
        const idx = headers.indexOf(col.toLowerCase());
        return idx >= 0 && idx < row.length ? row[idx].trim() : "";
      };

      const modelName = get("modelname") || get("model_name") || get("model");
      if (!modelName) {
        result.errors.push({ row: i + 1, message: "Missing model name" });
        continue;
      }

      const model = modelByName.get(modelName.toLowerCase());
      if (!model) {
        result.errors.push({ row: i + 1, message: `Model "${modelName}" not found` });
        continue;
      }

      let assetTag = get("assettag") || get("asset_tag") || get("tag");
      if (!assetTag) {
        assetTag = nextTag();
      }

      const statusRaw = (get("status") || "AVAILABLE").toUpperCase();
      const validStatuses = ["AVAILABLE", "CHECKED_OUT", "IN_MAINTENANCE", "RETIRED", "LOST", "RESERVED"];
      const status = validStatuses.includes(statusRaw) ? statusRaw : "AVAILABLE";

      const conditionRaw = (get("condition") || "GOOD").toUpperCase();
      const validConditions = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
      const condition = validConditions.includes(conditionRaw) ? conditionRaw : "GOOD";

      const locationName = get("locationname") || get("location_name") || get("location");
      const locationId = locationName ? locationMap.get(locationName.toLowerCase()) || null : null;

      const supplierName = get("suppliername") || get("supplier_name") || get("supplier");
      const supplierId = supplierName ? supplierMap.get(supplierName.toLowerCase()) || null : null;

      const tags = parseTags(get("tags"));

      // Check if asset tag already exists
      const existing = await prisma.asset.findFirst({
        where: { organizationId, assetTag },
      });

      if (existing) {
        await prisma.asset.update({
          where: { id: existing.id },
          data: {
            serialNumber: get("serialnumber") || get("serial_number") || existing.serialNumber,
            customName: get("customname") || get("custom_name") || existing.customName,
            status: status as "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "RETIRED" | "LOST" | "RESERVED",
            condition: condition as "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED",
            locationId: locationId ?? existing.locationId,
            supplierId: supplierId ?? existing.supplierId,
            purchaseDate: parseDate(get("purchasedate") || get("purchase_date")) ?? existing.purchaseDate,
            purchasePrice: parseDecimal(get("purchaseprice") || get("purchase_price")) ?? existing.purchasePrice,
            warrantyExpiry: parseDate(get("warrantyexpiry") || get("warranty_expiry")) ?? existing.warrantyExpiry,
            notes: get("notes") || existing.notes,
            ...(tags.length > 0 ? { tags } : {}),
          },
        });
        result.updated++;
      } else {
        await prisma.asset.create({
          data: {
            organizationId,
            modelId: model.id,
            assetTag,
            serialNumber: get("serialnumber") || get("serial_number") || null,
            customName: get("customname") || get("custom_name") || null,
            status: status as "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "RETIRED" | "LOST" | "RESERVED",
            condition: condition as "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED",
            locationId,
            supplierId,
            purchaseDate: parseDate(get("purchasedate") || get("purchase_date")),
            purchasePrice: parseDecimal(get("purchaseprice") || get("purchase_price")),
            warrantyExpiry: parseDate(get("warrantyexpiry") || get("warranty_expiry")),
            notes: get("notes") || null,
            tags,
          },
        });
        result.created++;
      }
    } catch (e) {
      result.errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  // Update org counter if we auto-generated tags
  if (counter > ((orgSettings.assetTagCounter as number) || 1)) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        metadata: JSON.stringify({ ...orgSettings, assetTagCounter: counter }),
      },
    });
  }

  return serialize(result) as ImportResult;
}

/**
 * Bulk-import rental rates onto existing models. Matches each row to a single
 * model by identifier (id → sku → modelNumber → name, in priority order) and
 * updates only the rate columns present in the row. Never creates models —
 * unmatched rows are reported as errors. When a `dailyRate` is provided, the
 * model's `defaultRentalPrice` (the quoting fallback) is kept in sync.
 */
export async function importModelRatesCSV(csvContent: string): Promise<ImportResult> {
  const { organizationId, userId, userName } = await requirePermission("model", "update");
  const rows = parseCSV(csvContent);
  if (rows.length === 0) throw new Error("CSV is empty");

  const normalizedHeaders = rows[0].map((h) => normalizeKey(h));
  if (!hasIdentifierColumn(normalizedHeaders)) {
    throw new Error('CSV must include a "name", "modelNumber", "sku", or "id" column');
  }
  if (!hasRateColumn(normalizedHeaders)) {
    throw new Error('CSV must include at least one rate column (dailyRate, weeklyRate, monthlyRate)');
  }

  const models = await prisma.model.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, sku: true, modelNumber: true },
  });
  const index = buildModelIndex(models as ModelIndexEntry[]);

  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue;

    const cells = new Map<string, string>();
    normalizedHeaders.forEach((key, idx) => {
      if (idx < row.length && !cells.has(key)) cells.set(key, row[idx]);
    });

    const parsed = parseRateRow(cells);
    if (parsed.errors.length > 0) {
      result.errors.push({ row: i + 1, message: parsed.errors.join("; ") });
      continue;
    }
    if (!parsed.hasRate) {
      result.errors.push({ row: i + 1, message: "No rate values to import" });
      continue;
    }

    const match = matchModel(parsed.identifier, index);
    if (match.error || !match.modelId) {
      result.errors.push({ row: i + 1, message: match.error ?? "Model not found" });
      continue;
    }

    try {
      const data: {
        dailyRate?: number;
        weeklyRate?: number;
        monthlyRate?: number;
        defaultRentalPrice?: number;
      } = { ...parsed.rates };
      // Keep the quoting fallback in sync with the daily rate.
      if (parsed.rates.dailyRate !== undefined) {
        data.defaultRentalPrice = parsed.rates.dailyRate;
      }

      await prisma.model.update({
        where: { id: match.modelId, organizationId },
        data,
      });
      result.updated++;
    } catch (e) {
      result.errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  if (result.updated > 0) {
    await logActivity({
      organizationId,
      userId,
      userName,
      action: "UPDATE",
      entityType: "model",
      entityId: organizationId,
      entityName: `${result.updated} models`,
      summary: `Imported rates for ${result.updated} model(s) via CSV${
        result.errors.length > 0 ? ` (${result.errors.length} rows skipped)` : ""
      }`,
    });
  }

  return serialize(result) as ImportResult;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Characters that trigger formula execution in spreadsheet applications */
function hasFormulaPrefix(s: string): boolean {
  if (!s) return false;
  const first = s.charCodeAt(0);
  // ASCII: = + - @ \t \r
  if (first === 0x3D || first === 0x2B || first === 0x2D || first === 0x40 || first === 0x09 || first === 0x0D) return true;
  // Full-width Unicode variants: ＝ ＋ － ＠
  if (first === 0xFF1D || first === 0xFF0B || first === 0xFF0D || first === 0xFF20) return true;
  return false;
}

function escapeCSV(headers: string[], rows: string[][]): string {
  const escapeLine = (fields: string[]) =>
    fields
      .map((f) => {
        // Sanitize formula injection: prefix dangerous characters with tab inside quotes
        const needsFormulaGuard = hasFormulaPrefix(f);
        const safeValue = needsFormulaGuard ? `\t${f}` : f;

        if (safeValue.includes(",") || safeValue.includes('"') || safeValue.includes("\n") || needsFormulaGuard) {
          return `"${safeValue.replace(/"/g, '""')}"`;
        }
        return safeValue;
      })
      .join(",");

  return [escapeLine(headers), ...rows.map(escapeLine)].join("\n");
}

function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && i + 1 < csv.length && csv[i + 1] === "\n") i++;
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }

  // Last field/row
  current.push(field);
  if (current.some((f) => f.trim())) rows.push(current);

  return rows;
}

function parseDecimal(value: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseTags(value: string): string[] {
  if (!value) return [];
  return value.split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

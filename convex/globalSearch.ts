import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, TableNames } from "./_generated/dataModel";
import { requireOrgRead } from "./lib/auth";
import {
  parseTerms,
  matchesQuery,
  bestSimilarity,
  includesLower,
  type SearchTerms,
} from "./lib/searchScore";

/**
 * Native global search — the LIVE-Convex replacement for the frozen-Postgres
 * `src/server/search.ts::globalSearch` pg_trgm engine.
 *
 * All 14 entity types are Convex-primary (their Postgres tables are frozen after the
 * write-inversion), so the old raw-SQL palette returned STALE results — anything
 * created after the inversion never appeared, and the Cmd+K palette + MCP `search`
 * tool silently missed recent records. This query reproduces the SQL's match + rank +
 * parent/child assembly backend-local over the live Convex docs, in ONE round trip.
 *
 * Match/rank parity lives in ./lib/searchScore.ts (see its header). The assembly below
 * mirrors src/server/search.ts line-for-line: same per-entity LIMITs, same child
 * drills (assets/bulks under models, contents under kits, projects under clients,
 * assets/kits/sub-locations under locations, models/sub-categories under categories),
 * same child-dedup sets, same type-boost + grouped relevance sort.
 *
 * SERVICE-gated: the `globalSearch` server action already authorises the caller via
 * `getOrgContext()` and calls this with the service token (same pattern as
 * projectEquipment.bundle). Org scoping is enforced by the `by_organizationId` reads.
 */

// Per-entity org-scan bound. The current tenant has hundreds of docs total, so this
// never trips today. HONEST LIMITATIONS at scale (documented, not yet hit):
//   - a tenant with >SCAN_CAP rows in one entity searches only the first SCAN_CAP by
//     the org index and can miss a match outside that prefix (under-returns, never
//     over-returns);
//   - the aggregate scan (15 entities × SCAN_CAP + child drills) could approach the
//     Convex per-query read limit and fail the whole search rather than degrade.
// The scale-correct fix is per-field Convex search indexes with federated merge (a
// larger follow-up); this JS-scan version exists to kill the frozen-Postgres STALENESS
// bug now, which is the user-visible regression. Keep SCAN_CAP well under the read cap.
const SCAN_CAP = 5000;

export type SearchResultType =
  | "model"
  | "kit"
  | "asset"
  | "bulk-asset"
  | "project"
  | "client"
  | "supplier"
  | "location"
  | "category"
  | "maintenance"
  | "crew"
  | "check-item"
  | "group-template"
  | "sub-hire";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  href: string;
  relevance: number;
  isChild?: boolean;
  status?: string;
};

// Convex's per-table index typing can't express "scan by_organizationId across an
// arbitrary table name" generically, so these two helpers use a narrow structural
// cast (the index/field names are validated at runtime by the deployment + our schema
// grep). Everything they return is re-typed precisely (`Doc<T>[]` / opaque records).
type IndexedQuery<R> = {
  withIndex: (name: string, fn: (b: { eq: (f: string, v: string) => unknown }) => unknown) => {
    take: (n: number) => Promise<R[]>;
    collect: () => Promise<R[]>;
  };
};

/** Org-scoped scan of a table via its `by_organizationId` index, typed as `Doc<T>[]`. */
async function orgScan<T extends TableNames>(ctx: QueryCtx, table: T, orgId: string): Promise<Doc<T>[]> {
  const q = ctx.db.query(table) as unknown as IndexedQuery<Doc<T>>;
  return q.withIndex("by_organizationId", (b) => b.eq("organizationId", orgId)).take(SCAN_CAP);
}

/** Collect all rows of `table` whose `field` (an indexed FK) is in `ids`, flattened. */
async function collectByIndex(ctx: QueryCtx, table: TableNames, index: string, field: string, ids: string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const rows = await Promise.all(
    ids.map((id) => {
      const q = ctx.db.query(table) as unknown as IndexedQuery<Record<string, unknown>>;
      return q.withIndex(index, (b) => b.eq(field, id)).collect();
    }),
  );
  return rows.flat();
}

function groupBy<T>(items: T[], keyFn: (item: T) => string | undefined | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

/** Sort scored rows by descending match_quality then a stable text tiebreak; take `limit`. */
function rankLimit<T extends { q: number }>(rows: T[], tiebreak: (r: T) => string, limit: number): T[] {
  rows.sort((a, b) => (b.q - a.q) || tiebreak(a).localeCompare(tiebreak(b)));
  return rows.slice(0, limit);
}

function nonNull<T>(x: T | null): x is T {
  return x !== null;
}

export const search = query({
  args: { orgId: v.string(), query: v.string() },
  handler: async (ctx, { orgId, query: rawQuery }): Promise<{ results: SearchResult[] }> => {
    await requireOrgRead(ctx, orgId); // browser-callable (user token) + service (PDF/API) short-circuits allow

    if (!rawQuery || rawQuery.trim().length < 2) return { results: [] };
    const terms: SearchTerms = parseTerms(rawQuery);
    if (terms.nq.length < 1) return { results: [] };
    const { ql } = terms;

    // ── Full org scans (live Convex) + lookup maps for joins ──────────────────
    const [
      allModels, allKits, allAssets, allBulks, allProjects, allClients, allSuppliers,
      allLocations, allCategories, allMaintenance, allCrew, allCrewRoles, allCheckItems,
      allGroupTemplates, allSubHires,
    ] = await Promise.all([
      orgScan(ctx, "models", orgId),
      orgScan(ctx, "kits", orgId),
      orgScan(ctx, "assets", orgId),
      orgScan(ctx, "bulkAssets", orgId),
      orgScan(ctx, "projects", orgId),
      orgScan(ctx, "clients", orgId),
      orgScan(ctx, "suppliers", orgId),
      orgScan(ctx, "locations", orgId),
      orgScan(ctx, "categories", orgId),
      orgScan(ctx, "maintenanceRecords", orgId),
      orgScan(ctx, "crewMembers", orgId),
      orgScan(ctx, "crewRoles", orgId),
      orgScan(ctx, "checkItems", orgId),
      orgScan(ctx, "groupTemplates", orgId),
      orgScan(ctx, "subHires", orgId),
    ]);

    const modelById = new Map(allModels.map((m) => [m.id, m]));
    const clientById = new Map(allClients.map((c) => [c.id, c]));
    const supplierById = new Map(allSuppliers.map((s) => [s.id, s]));
    const crewRoleById = new Map(allCrewRoles.map((r) => [r.id, r]));
    const categoryById = new Map(allCategories.map((c) => [c.id, c]));
    const assetById = new Map(allAssets.map((a) => [a.id, a]));

    // ── Sub-hire item descriptions (no org index on subHireItems → drill per row) ──
    const subHireItemDescs = new Map<string, string[]>();
    await Promise.all(
      allSubHires.map(async (sh) => {
        const items = await ctx.db
          .query("subHireItems")
          .withIndex("by_subHireId", (q) => q.eq("subHireId", sh.id))
          .collect();
        subHireItemDescs.set(sh.id, items.map((i) => i.description ?? "").filter(Boolean));
      }),
    );

    // ── Score + filter + rank each entity (parity with the SQL WHERE + LIMIT) ──

    // Models (isActive) — LIMIT 15
    const models = rankLimit(
      allModels
        .filter((m) => m.isActive === true)
        .map((m) => {
          if (!matchesQuery(terms, {
            ilikeFields: [m.name, m.manufacturer, m.modelNumber, m.description],
            normFields: [m.name, m.manufacturer, m.modelNumber, m.description],
            fuzzyFields: [m.name, m.manufacturer, m.modelNumber],
            tags: m.tags,
          })) return null;
          const categoryName = m.categoryId ? categoryById.get(m.categoryId)?.name ?? null : null;
          return { ...m, categoryName, q: bestSimilarity(terms, [m.name, m.manufacturer, m.modelNumber]) };
        })
        .filter(nonNull),
      (m) => m.name, 15,
    );

    // Kits (isActive) — LIMIT 10
    const kits = rankLimit(
      allKits
        .filter((k) => k.isActive === true)
        .map((k) => {
          if (!matchesQuery(terms, {
            ilikeFields: [k.name, k.assetTag, k.description, k.caseType],
            normFields: [k.name, k.assetTag],
            fuzzyFields: [k.name, k.assetTag],
            tags: k.tags,
          })) return null;
          return { ...k, q: bestSimilarity(terms, [k.name, k.assetTag]) };
        })
        .filter(nonNull),
      (k) => k.name, 10,
    );

    // Assets (isActive, join model) — LIMIT 10
    const assets = rankLimit(
      allAssets
        .filter((a) => a.isActive === true)
        .map((a) => {
          // Inner join asset→model (mirrors the SQL JOIN): drop assets whose model
          // isn't in this org's live set (orphan / cross-org ref).
          const model = a.modelId ? modelById.get(a.modelId) : undefined;
          if (!model) return null;
          const modelName = model.name;
          if (!matchesQuery(terms, {
            ilikeFields: [a.assetTag, a.serialNumber, a.customName, modelName],
            normFields: [a.assetTag, a.serialNumber, a.customName, modelName],
            fuzzyFields: [a.assetTag, modelName, a.customName],
            tags: a.tags,
          })) return null;
          return { ...a, modelName, q: bestSimilarity(terms, [a.assetTag, a.serialNumber, a.customName, modelName]) };
        })
        .filter(nonNull),
      (a) => a.assetTag, 10,
    );

    // Bulk assets (isActive, join model) — LIMIT 10
    const bulkAssets = rankLimit(
      allBulks
        .filter((b) => b.isActive === true)
        .map((b) => {
          // Inner join bulk→model (mirrors the SQL JOIN).
          const model = b.modelId ? modelById.get(b.modelId) : undefined;
          if (!model) return null;
          const modelName = model.name;
          if (!matchesQuery(terms, {
            ilikeFields: [b.assetTag, modelName],
            normFields: [b.assetTag, modelName],
            fuzzyFields: [b.assetTag, modelName],
            tags: b.tags,
          })) return null;
          return { ...b, modelName, q: bestSimilarity(terms, [b.assetTag, modelName]) };
        })
        .filter(nonNull),
      (b) => b.assetTag, 10,
    );

    // Projects (isTemplate === false, join client) — LIMIT 10
    const projects = rankLimit(
      allProjects
        .filter((p) => p.isTemplate === false)
        .map((p) => {
          const clientName = p.clientId ? clientById.get(p.clientId)?.name ?? null : null;
          if (!matchesQuery(terms, {
            ilikeFields: [p.name, p.projectNumber, p.description, clientName],
            normFields: [p.name, p.projectNumber],
            fuzzyFields: [p.name, p.projectNumber],
            tags: p.tags,
          })) return null;
          return { ...p, clientName, q: bestSimilarity(terms, [p.name, p.projectNumber, clientName]) };
        })
        .filter(nonNull),
      (p) => p.name, 10,
    );

    // Clients (isActive) — LIMIT 10
    const clients = rankLimit(
      allClients
        .filter((c) => c.isActive === true)
        .map((c) => {
          if (!matchesQuery(terms, {
            ilikeFields: [c.name, c.contactName, c.contactEmail],
            normFields: [c.name],
            fuzzyFields: [c.name, c.contactName],
            tags: c.tags,
          })) return null;
          return { ...c, q: bestSimilarity(terms, [c.name, c.contactName]) };
        })
        .filter(nonNull),
      (c) => c.name, 10,
    );

    // Suppliers (isActive) — LIMIT 10
    const suppliers = rankLimit(
      allSuppliers
        .filter((s) => s.isActive === true)
        .map((s) => {
          if (!matchesQuery(terms, {
            ilikeFields: [s.name, s.contactName, s.accountNumber, s.email],
            normFields: [s.name],
            fuzzyFields: [s.name, s.contactName],
            tags: s.tags,
          })) return null;
          return { ...s, q: bestSimilarity(terms, [s.name, s.contactName]) };
        })
        .filter(nonNull),
      (s) => s.name, 10,
    );

    // Locations (no active filter) — LIMIT 5
    const locations = rankLimit(
      allLocations
        .map((l) => {
          if (!matchesQuery(terms, { ilikeFields: [l.name, l.address], normFields: [l.name], fuzzyFields: [l.name], tags: l.tags })) return null;
          return { ...l, q: bestSimilarity(terms, [l.name]) };
        })
        .filter(nonNull),
      (l) => l.name, 5,
    );

    // Categories (modelCount from live models) — LIMIT 5
    const activeModelCountByCategory = new Map<string, number>();
    for (const m of allModels) {
      if (m.isActive === true && m.categoryId) {
        activeModelCountByCategory.set(m.categoryId, (activeModelCountByCategory.get(m.categoryId) ?? 0) + 1);
      }
    }
    const categories = rankLimit(
      allCategories
        .map((c) => {
          if (!matchesQuery(terms, { ilikeFields: [c.name, c.description], normFields: [c.name], fuzzyFields: [c.name], tags: c.tags })) return null;
          return { ...c, modelCount: activeModelCountByCategory.get(c.id) ?? 0, q: bestSimilarity(terms, [c.name]) };
        })
        .filter(nonNull),
      (c) => c.name, 5,
    );

    // Maintenance — LIMIT 3
    const maintenance = rankLimit(
      allMaintenance
        .map((mr) => {
          if (!matchesQuery(terms, { ilikeFields: [mr.title, mr.description], normFields: [mr.title], fuzzyFields: [mr.title], tags: mr.tags })) return null;
          return { ...mr, q: bestSimilarity(terms, [mr.title]) };
        })
        .filter(nonNull),
      (mr) => mr.title, 3,
    );

    // Crew (status !== ARCHIVED, join role) — LIMIT 10
    const crew = rankLimit(
      allCrew
        .filter((cm) => cm.status !== "ARCHIVED")
        .map((cm) => {
          const roleName = cm.crewRoleId ? crewRoleById.get(cm.crewRoleId)?.name ?? null : null;
          const fullName = `${cm.firstName} ${cm.lastName}`;
          if (!matchesQuery(terms, {
            ilikeFields: [cm.firstName, cm.lastName, fullName, cm.email, cm.phone, cm.department, roleName],
            // SQL normalized only `firstName || lastName` (no separator).
            normFields: [`${cm.firstName}${cm.lastName}`],
            fuzzyFields: [fullName],
            tags: cm.tags,
          })) return null;
          return { ...cm, roleName, q: bestSimilarity(terms, [cm.firstName, cm.lastName, fullName, cm.email]) };
        })
        .filter(nonNull),
      (cm) => cm.lastName, 10,
    );

    // Check items — LIMIT 10
    const checkItems = rankLimit(
      allCheckItems
        .map((ci) => {
          if (!matchesQuery(terms, { ilikeFields: [ci.label, ci.category, ci.description], normFields: [ci.label], fuzzyFields: [ci.label] })) return null;
          return { ...ci, q: bestSimilarity(terms, [ci.label, ci.category]) };
        })
        .filter(nonNull),
      (ci) => ci.label, 10,
    );

    // Group templates (itemCount from live groupTemplateItems) — LIMIT 10
    const groupTemplateItemCount = new Map<string, number>();
    await Promise.all(
      allGroupTemplates.map(async (gt) => {
        const items = await ctx.db
          .query("groupTemplateItems")
          .withIndex("by_templateId", (q) => q.eq("templateId", gt.id))
          .collect();
        groupTemplateItemCount.set(gt.id, items.length);
      }),
    );
    const groupTemplates = rankLimit(
      allGroupTemplates
        .map((gt) => {
          if (!matchesQuery(terms, { ilikeFields: [gt.name, gt.description], normFields: [gt.name], fuzzyFields: [gt.name] })) return null;
          return { ...gt, itemCount: groupTemplateItemCount.get(gt.id) ?? 0, q: bestSimilarity(terms, [gt.name, gt.description]) };
        })
        .filter(nonNull),
      (gt) => gt.name, 10,
    );

    // Sub-hires (join supplier + item description drill) — LIMIT 10
    const subHires = rankLimit(
      allSubHires
        .map((sh) => {
          // Inner join sub-hire→supplier (mirrors the SQL JOIN).
          const supplier = sh.supplierId ? supplierById.get(sh.supplierId) : undefined;
          if (!supplier) return null;
          const supplierName = supplier.name;
          const itemHit = (subHireItemDescs.get(sh.id) ?? []).some((d) => includesLower(d, ql));
          const matched = itemHit || matchesQuery(terms, {
            ilikeFields: [sh.orderNumber, supplierName, sh.supplierReference, sh.notes],
            normFields: [sh.orderNumber, supplierName],
            fuzzyFields: [sh.orderNumber, supplierName],
          });
          if (!matched) return null;
          return { ...sh, supplierName, q: bestSimilarity(terms, [sh.orderNumber, supplierName, sh.supplierReference]) };
        })
        .filter(nonNull),
      (sh) => sh.orderNumber, 10,
    );

    // ── Child drills for matched parents ──────────────────────────────────────
    const [childAssets, childBulks, kitItemsRaw, clientProjects, locAssets, locKits, subLocations, catModels, subCategories] =
      await Promise.all([
        collectByIndex(ctx, "assets", "by_modelId", "modelId", models.map((m) => m.id)),
        collectByIndex(ctx, "bulkAssets", "by_modelId", "modelId", models.map((m) => m.id)),
        collectByIndex(ctx, "kitSerializedItems", "by_kitId", "kitId", kits.map((k) => k.id)),
        collectByIndex(ctx, "projects", "by_clientId", "clientId", clients.map((c) => c.id)),
        collectByIndex(ctx, "assets", "by_locationId", "locationId", locations.map((l) => l.id)),
        collectByIndex(ctx, "kits", "by_locationId", "locationId", locations.map((l) => l.id)),
        collectByIndex(ctx, "locations", "by_parentId", "parentId", locations.map((l) => l.id)),
        collectByIndex(ctx, "models", "by_categoryId", "categoryId", categories.map((c) => c.id)),
        collectByIndex(ctx, "categories", "by_parentId", "parentId", categories.map((c) => c.id)),
      ]);

    type C = Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
    const bool = (v: unknown): boolean => v === true;
    const byField = (f: string) => (a: C, b: C) => str(a[f]).localeCompare(str(b[f]));

    // Child ordering — mirror the SQL secondary ORDER BY within each parent group
    // (groupBy preserves the sorted insertion order, so sorting the flat list first
    // gives per-parent ordering identical to `ORDER BY parentId, <field>`).
    (childAssets as C[]).sort(byField("assetTag"));
    (childBulks as C[]).sort(byField("assetTag"));
    (clientProjects as C[]).sort((a, b) => num(b.createdAt) - num(a.createdAt)); // createdAt DESC
    (locAssets as C[]).sort(byField("assetTag"));
    (locKits as C[]).sort(byField("assetTag"));
    (subLocations as C[]).sort(byField("name"));
    (catModels as C[]).sort(byField("name"));
    (subCategories as C[]).sort(byField("name"));

    // Kit serialized items → inner-join asset→model (SQL JOIN drops orphans), resolve
    // display fields, then order by sortOrder ASC, assetTag ASC.
    const kitItems = (kitItemsRaw as C[])
      .map((ksi) => {
        const assetId = str(ksi.assetId) || null;
        const asset = assetId ? assetById.get(assetId) : undefined;
        const model = asset?.modelId ? modelById.get(asset.modelId) : undefined;
        if (!asset || !model) return null; // orphaned kit item — SQL inner join dropped it
        return {
          assetTag: asset.assetTag,
          name: model.name,
          assetId,
          kitId: str(ksi.kitId),
          sortOrder: num(ksi.sortOrder),
        };
      })
      .filter(nonNull)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.assetTag.localeCompare(b.assetTag));

    const assetsByModel = groupBy(childAssets as C[], (a) => (bool(a.isActive) ? str(a.modelId) : undefined));
    const bulkByModel = groupBy(childBulks as C[], (b) => (bool(b.isActive) ? str(b.modelId) : undefined));
    const itemsByKit = groupBy(kitItems, (ki) => ki.kitId);
    const projectsByClient = groupBy(clientProjects as C[], (p) => (p.isTemplate === false ? str(p.clientId) : undefined));
    // Location child assets inner-join model (SQL `asset JOIN model`): drop active
    // assets whose model isn't in this org's live set (orphan / cross-org).
    const assetsByLocation = groupBy(locAssets as C[], (a) =>
      bool(a.isActive) && a.modelId && modelById.has(str(a.modelId)) ? str(a.locationId) : undefined,
    );
    const kitsByLocation = groupBy(locKits as C[], (k) => (bool(k.isActive) ? str(k.locationId) : undefined));
    const subLocationsByParent = groupBy(subLocations as C[], (l) => str(l.parentId));
    const modelsByCategory = groupBy(catModels as C[], (m) => (bool(m.isActive) ? str(m.categoryId) : undefined));
    const subCategoriesByParent = groupBy(subCategories as C[], (c) => str(c.parentId));

    // ── Assemble results (mirrors src/server/search.ts assembly order) ─────────
    const shownAsChildAssetIds = new Set<string>();
    const shownAsChildBulkIds = new Set<string>();
    const results: SearchResult[] = [];

    for (const m of models) {
      results.push({
        id: m.id, type: "model",
        title: m.name + (m.modelNumber ? ` (${m.modelNumber})` : ""),
        subtitle: [m.manufacturer, m.categoryName].filter(Boolean).join(" · ") || null,
        href: `/assets/models/${m.id}`, relevance: m.q,
      });
      for (const a of assetsByModel.get(m.id) || []) {
        shownAsChildAssetIds.add(str(a.id));
        results.push({
          id: str(a.id), type: "asset", isChild: true,
          title: str(a.assetTag) + (a.customName ? ` — ${str(a.customName)}` : ""),
          subtitle: str(a.status) + (a.serialNumber ? ` · SN: ${str(a.serialNumber)}` : ""),
          href: `/assets/registry/${str(a.id)}`, relevance: 0,
        });
      }
      for (const b of bulkByModel.get(m.id) || []) {
        shownAsChildBulkIds.add(str(b.id));
        results.push({
          id: str(b.id), type: "bulk-asset", isChild: true,
          title: str(b.assetTag), subtitle: `${typeof b.totalQuantity === "number" ? b.totalQuantity : 0} units`,
          href: `/assets/models/${m.id}`, relevance: 0,
        });
      }
    }

    for (const k of kits) {
      results.push({
        id: k.id, type: "kit",
        title: `${k.assetTag} — ${k.name}`,
        subtitle: k.caseType || k.description || null,
        href: `/kits/${k.id}`, relevance: k.q,
      });
      for (const ki of itemsByKit.get(k.id) || []) {
        if (ki.assetId) shownAsChildAssetIds.add(ki.assetId);
        results.push({
          id: ki.assetId || k.id, type: "asset", isChild: true,
          title: ki.assetTag, subtitle: ki.name,
          href: `/assets/registry/${ki.assetId}`, relevance: 0,
        });
      }
    }

    for (const a of assets) {
      if (shownAsChildAssetIds.has(a.id)) continue;
      results.push({
        id: a.id, type: "asset",
        title: a.assetTag + (a.customName ? ` — ${a.customName}` : ""),
        subtitle: a.modelName + (a.serialNumber ? ` · SN: ${a.serialNumber}` : ""),
        href: `/assets/registry/${a.id}`, relevance: a.q,
      });
    }

    for (const b of bulkAssets) {
      if (shownAsChildBulkIds.has(b.id)) continue;
      results.push({
        id: b.id, type: "bulk-asset",
        title: b.assetTag, subtitle: `${b.modelName} (${b.totalQuantity ?? 0} units)`,
        href: `/assets/models/${b.modelId}`, relevance: b.q,
      });
    }

    const shownAsChildProjectIds = new Set<string>();
    for (const c of clients) {
      results.push({
        id: c.id, type: "client",
        title: c.name, subtitle: c.contactName || c.contactEmail || null,
        href: `/clients/${c.id}`, relevance: c.q,
      });
      for (const p of projectsByClient.get(c.id) || []) {
        shownAsChildProjectIds.add(str(p.id));
        results.push({
          id: str(p.id), type: "project", isChild: true,
          title: `${str(p.projectNumber)} — ${str(p.name)}`, subtitle: str(p.status),
          href: `/projects/${str(p.id)}`, relevance: 0, status: str(p.status),
        });
      }
    }

    for (const p of projects) {
      if (shownAsChildProjectIds.has(p.id)) continue;
      results.push({
        id: p.id, type: "project",
        title: `${p.projectNumber} — ${p.name}`, subtitle: p.clientName || p.status || null,
        href: `/projects/${p.id}`, relevance: p.q, status: p.status,
      });
    }

    for (const s of suppliers) {
      results.push({
        id: s.id, type: "supplier",
        title: s.name,
        subtitle: [s.contactName, s.accountNumber ? `Acct: ${s.accountNumber}` : null].filter(Boolean).join(" · ") || null,
        href: `/suppliers/${s.id}`, relevance: s.q,
      });
    }

    for (const l of locations) {
      results.push({
        id: l.id, type: "location",
        title: l.name, subtitle: l.address || null,
        href: `/locations/${l.id}`, relevance: l.q,
      });
      for (const sub of subLocationsByParent.get(l.id) || []) {
        results.push({
          id: str(sub.id), type: "location", isChild: true,
          title: str(sub.name), subtitle: sub.address ? str(sub.address) : null,
          href: `/locations/${str(sub.id)}`, relevance: 0,
        });
      }
      for (const a of assetsByLocation.get(l.id) || []) {
        shownAsChildAssetIds.add(str(a.id));
        results.push({
          id: str(a.id), type: "asset", isChild: true,
          title: str(a.assetTag) + (a.customName ? ` — ${str(a.customName)}` : ""),
          subtitle: a.modelId ? modelById.get(str(a.modelId))?.name ?? "" : "",
          href: `/assets/registry/${str(a.id)}`, relevance: 0,
        });
      }
      for (const k of kitsByLocation.get(l.id) || []) {
        results.push({
          id: str(k.id), type: "kit", isChild: true,
          title: `${str(k.assetTag)} — ${str(k.name)}`, subtitle: null,
          href: `/kits/${str(k.id)}`, relevance: 0,
        });
      }
    }

    for (const cat of categories) {
      results.push({
        id: cat.id, type: "category",
        title: cat.name, subtitle: `${cat.modelCount} model${cat.modelCount !== 1 ? "s" : ""}`,
        href: `/assets/categories/${cat.id}`, relevance: cat.q,
      });
      for (const sub of subCategoriesByParent.get(cat.id) || []) {
        results.push({
          id: str(sub.id), type: "category", isChild: true,
          title: str(sub.name), subtitle: null,
          href: `/assets/categories/${str(sub.id)}`, relevance: 0,
        });
      }
      for (const m of modelsByCategory.get(cat.id) || []) {
        results.push({
          id: str(m.id), type: "model", isChild: true,
          title: str(m.name) + (m.modelNumber ? ` (${str(m.modelNumber)})` : ""),
          subtitle: m.manufacturer ? str(m.manufacturer) : null,
          href: `/assets/models/${str(m.id)}`, relevance: 0,
        });
      }
    }

    for (const mr of maintenance) {
      results.push({
        id: mr.id, type: "maintenance",
        title: mr.title, subtitle: mr.status ?? null,
        href: `/maintenance/${mr.id}`, relevance: mr.q,
      });
    }

    for (const c of crew) {
      results.push({
        id: c.id, type: "crew",
        title: `${c.firstName} ${c.lastName}`,
        subtitle: [c.roleName, c.department].filter(Boolean).join(" · ") || c.email || null,
        href: `/crew/${c.id}`, relevance: c.q,
      });
    }

    for (const ci of checkItems) {
      const typeLabel = ci.type === "PASS_FAIL" ? "Pass/Fail" : ci.type === "NOTES" ? "Notes" : ci.type === "MEASUREMENT" ? "Measurement" : "Dropdown";
      results.push({
        id: ci.id, type: "check-item",
        title: ci.label,
        subtitle: [typeLabel, ci.category].filter(Boolean).join(" · "),
        href: `/settings/check-items`, relevance: ci.q,
      });
    }

    for (const gt of groupTemplates) {
      results.push({
        id: gt.id, type: "group-template",
        title: gt.name,
        subtitle: gt.description ?? `${gt.itemCount} item${gt.itemCount !== 1 ? "s" : ""}`,
        href: `/settings/group-templates`, relevance: gt.q,
      });
    }

    for (const sh of subHires) {
      const href = sh.projectId
        ? `/projects/${sh.projectId}?tab=equipment&subHireId=${sh.id}`
        : `/suppliers`;
      results.push({
        id: sh.id, type: "sub-hire",
        title: `${sh.orderNumber} — ${sh.supplierName}`,
        subtitle: [sh.status, sh.supplierReference].filter(Boolean).join(" · ") || null,
        href, relevance: sh.q,
      });
    }

    // ── Group parent+children, sort by relevance with type boost ───────────────
    type ResultGroup = { parent: SearchResult; children: SearchResult[] };
    const groups: ResultGroup[] = [];
    for (const r of results) {
      if (r.isChild && groups.length > 0) {
        groups[groups.length - 1].children.push(r);
      } else {
        groups.push({ parent: r, children: [] });
      }
    }
    const typeBoost: Record<string, number> = { model: 0.05, category: 0.02, kit: 0.01 };
    groups.sort((a, b) => {
      const aScore = a.parent.relevance + (typeBoost[a.parent.type] || 0);
      const bScore = b.parent.relevance + (typeBoost[b.parent.type] || 0);
      return bScore - aScore;
    });
    const sorted: SearchResult[] = [];
    for (const g of groups) {
      sorted.push(g.parent);
      sorted.push(...g.children);
    }
    return { results: sorted };
  },
});

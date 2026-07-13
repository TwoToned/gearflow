/**
 * Semantic, versioned, validated WHOLE-ORG export (READ-ONLY — no mutations).
 *
 * The migration-gate safety + portability artifact: a per-org semantic dump,
 * distinct from the raw full-deployment Convex snapshot. Every one of the 101
 * schema tables is either exported or EXPLICITLY excluded with a reason — a new
 * unclassified schema table makes this FAIL (see scripts/org-export-tables.ts),
 * never silently drop.
 *
 * Usage:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/export-org.ts [orgId] [--out <path>]
 *
 * Defaults: orgId = the single org in the deployment; out = ./org-export-<orgId>-<stamp>.json
 *
 * Token refresh: `getConvexClient()` is re-fetched per round-trip so a long run
 * keeps a fresh service token (5-min TTL). See scripts/convex-backfill-activity-log.ts.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import convexSchema from "../convex/schema";
import {
  SCHEMA_VERSION,
  DIRECT_TABLES,
  FILTER_TABLES,
  PARENT_JOIN,
  EXCLUDED,
  MEDIA_TABLES,
  EXPORTED_TABLES,
  EXPECTED_TABLE_COUNT,
  assertCoverage,
} from "./org-export-tables";

const PAGE = 500;
const PARENT_CHUNK = 50; // parent ids per childRowsByParentIds call

type Row = Record<string, unknown>;
type PageResult = { page: Row[]; isDone: boolean; continueCursor: string };
type CountResult = { count: number; isDone: boolean; continueCursor: string };

function parseArgs(argv: string[]): { orgId?: string; out?: string } {
  const out: { orgId?: string; out?: string } = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out.out = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest[0]) out.orgId = rest[0];
  return out;
}

/** Page a DIRECT table (by_organizationId) fully. */
async function readDirect(table: string, orgId: string): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const res: PageResult = await convex.query(api.orgExport.exportTablePage, {
      table,
      orgId,
      cursor,
      numItems: PAGE,
    });
    rows.push(...res.page);
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  return rows;
}

/** Page a FILTER table (org column, no index) fully. */
async function readFiltered(table: string, orgId: string, orgField: string): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const res: PageResult = await convex.query(api.orgExport.scanTableFiltered, {
      table,
      orgId,
      orgField,
      cursor,
      numItems: PAGE,
    });
    rows.push(...res.page);
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  return rows;
}

/** Collect PARENT_JOIN children by chunking parent cuid ids. */
async function readChildren(
  table: string,
  indexName: string,
  parentField: string,
  parentIds: string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < parentIds.length; i += PARENT_CHUNK) {
    const chunk = parentIds.slice(i, i + PARENT_CHUNK);
    const convex = await getConvexClient();
    const res = (await convex.query(api.orgExport.childRowsByParentIds, {
      table,
      indexName,
      parentField,
      parentIds: chunk,
    })) as Row[];
    rows.push(...res);
  }
  return rows;
}

/** Paginated independent count for a DIRECT / FILTER table. */
async function countPaginated(table: string, orgId: string, orgField?: string): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const res: CountResult = await convex.query(api.orgExport.countTable, {
      table,
      orgId,
      orgField,
      cursor,
      numItems: PAGE,
    });
    total += res.count;
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  return total;
}

async function main() {
  const { orgId: argOrg, out: argOut } = parseArgs(process.argv.slice(2));

  // ---- Coverage guard (fail loudly on any unclassified schema table) --------
  const schemaTables = Object.keys(convexSchema.tables);
  assertCoverage(schemaTables);
  if (schemaTables.length !== EXPECTED_TABLE_COUNT) {
    throw new Error(
      `Schema has ${schemaTables.length} tables, classification expects ${EXPECTED_TABLE_COUNT}. ` +
        `Reconcile scripts/org-export-tables.ts before exporting.`,
    );
  }
  console.log(`Coverage OK: all ${schemaTables.length} schema tables classified.`);

  // ---- Resolve org ----------------------------------------------------------
  let orgId = argOrg;
  if (!orgId) {
    const convex = await getConvexClient();
    const ids = await convex.query(api.orgExport.listOrgIds, {});
    if (ids.length === 0) throw new Error("No organizations in the deployment — nothing to export.");
    if (ids.length > 1) {
      throw new Error(
        `Deployment holds ${ids.length} organizations (${ids.join(", ")}). ` +
          `Pass an explicit orgId: scripts/export-org.ts <orgId>`,
      );
    }
    orgId = ids[0];
  }
  console.log(`Exporting organization: ${orgId}`);

  const convex0 = await getConvexClient();
  let orgRow: unknown = await convex0.query(api.orgExport.getOrgRow, { orgId });
  if (!orgRow) {
    // Org IDENTITY lives in Postgres (Better Auth) — it is deliberately NOT mirrored
    // into the Convex `organizations` table. Pull the identity label from the
    // authoritative source so the export header is complete; the DOMAIN data below is
    // all Convex, keyed by organizationId.
    const pgOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!pgOrg) {
      throw new Error(`Organization not found in Convex mirror or Postgres: ${orgId}`);
    }
    orgRow = {
      id: pgOrg.id,
      name: pgOrg.name,
      slug: pgOrg.slug,
      createdAt: pgOrg.createdAt?.getTime?.() ?? null,
      _identitySource: "postgres-betterauth",
    };
  }

  const tables: Record<string, Row[]> = {};

  // ---- DIRECT ---------------------------------------------------------------
  for (const table of DIRECT_TABLES) {
    tables[table] = await readDirect(table, orgId);
    console.log(`  DIRECT  ${table}: ${tables[table].length}`);
  }

  // ---- FILTER ---------------------------------------------------------------
  for (const { table, orgField } of FILTER_TABLES) {
    tables[table] = await readFiltered(table, orgId, orgField);
    console.log(`  FILTER  ${table} (${orgField}): ${tables[table].length}`);
  }

  // ---- PARENT_JOIN ----------------------------------------------------------
  for (const { table, parentTable, index, field } of PARENT_JOIN) {
    const parents = tables[parentTable];
    if (!parents) throw new Error(`Parent table ${parentTable} not exported before child ${table}`);
    const parentIds = parents.map((r) => r.id as string).filter(Boolean);
    tables[table] = await readChildren(table, index, field, parentIds);
    console.log(`  CHILD   ${table} (via ${parentTable}.${field}, ${parentIds.length} parents): ${tables[table].length}`);
  }

  // ---- File manifest --------------------------------------------------------
  type ManifestEntry = { storageId: string; table: string; refId: string; contentType?: string; size?: number };
  const fileManifest: ManifestEntry[] = [];
  for (const r of tables.storedFiles ?? []) {
    if (typeof r.storageId === "string") {
      fileManifest.push({ storageId: r.storageId, table: "storedFiles", refId: r.storageId });
    }
  }
  for (const { table, refField } of MEDIA_TABLES) {
    for (const r of tables[table] ?? []) {
      // Media rows reference a fileUploads row via `fileId` (the portable file
      // handle) and their owning entity via `refField`.
      if (typeof r.fileId === "string") {
        fileManifest.push({ storageId: r.fileId, table, refId: (r[refField] as string) ?? "" });
      }
    }
  }

  // ---- Counts + coverage ----------------------------------------------------
  const counts: Record<string, number> = {};
  for (const t of EXPORTED_TABLES) counts[t] = (tables[t] ?? []).length;

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    organizationId: orgId,
    orgRow,
    tables,
    fileManifest,
    counts,
    coverage: {
      total: EXPECTED_TABLE_COUNT,
      exported: EXPORTED_TABLES,
      excluded: {
        auth: EXCLUDED.auth,
        platform: EXCLUDED.platform,
        ephemeral: EXCLUDED.ephemeral,
      },
    },
  };

  const stamp = new Date(artifact.exportedAt).toISOString().replace(/[:.]/g, "-");
  const outPath = argOut ?? `./org-export-${orgId}-${stamp}.json`;
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nWrote ${outPath} — ${EXPORTED_TABLES.length} tables, ${totalRows} rows, ${fileManifest.length} file refs.`);

  // ---- Validation pass (independent re-count) -------------------------------
  console.log(`\nValidating counts…`);
  const mismatches: string[] = [];

  for (const table of DIRECT_TABLES) {
    const recount = await countPaginated(table, orgId);
    if (recount !== counts[table]) {
      mismatches.push(`${table}: exported ${counts[table]} ≠ recount ${recount}`);
    }
  }
  for (const { table, orgField } of FILTER_TABLES) {
    const recount = await countPaginated(table, orgId, orgField);
    if (recount !== counts[table]) {
      mismatches.push(`${table}: exported ${counts[table]} ≠ recount ${recount}`);
    }
  }
  for (const { table, parentTable, index, field } of PARENT_JOIN) {
    const parentIds = (tables[parentTable] ?? []).map((r) => r.id as string).filter(Boolean);
    const recount = (await readChildren(table, index, field, parentIds)).length;
    if (recount !== counts[table]) {
      mismatches.push(`${table}: exported ${counts[table]} ≠ recount ${recount}`);
    }
  }

  console.log(`\nPer-table counts:`);
  for (const t of EXPORTED_TABLES) console.log(`  ${t}: ${counts[t]}`);
  console.log(`  TOTAL: ${totalRows}`);

  if (mismatches.length) {
    console.error(`\nVALIDATION FAILED — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) console.error(`  ✗ ${m}`);
    process.exit(1);
  }
  console.log(`\nValidation OK: all ${EXPORTED_TABLES.length} exported table counts match.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });

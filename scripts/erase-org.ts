/**
 * Right-to-erasure hard-delete (#1077, A7, M5) — the ONLY thing in this
 * codebase that can actually delete an org. Archiving (#1075, D12) is the
 * automatic terminal state and never destroys; this is a separate,
 * explicitly-invoked action for a genuine erasure request (POLICY §8.12).
 *
 * Cascades through every Convex table `scripts/org-export-tables.ts`
 * classifies as domain data (DIRECT / FILTER / PARENT_JOIN) — the SAME
 * classification `scripts/export-org.ts` reads, so erasure coverage can never
 * silently drift from export coverage. Deletes the `_storage` bytes behind
 * every `storedFiles` row before deleting the records themselves. Finally
 * deletes the Postgres `Organization` row, which cascades `Member`/
 * `Invitation`/etc. via the schema's own `onDelete: Cascade`.
 *
 * Safety:
 *  - Refuses to run unless the org is already ARCHIVED (archive first, via
 *    the admin UI — this only ever runs on something already retired).
 *  - Requires `--confirm <orgId>` typed exactly — no positional-arg-only path.
 *  - No dry-run flag: this is destructive by design once confirmed. Export
 *    the org first (scripts/export-org.ts) if you want a backup.
 *
 * Usage:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/erase-org.ts <orgId> --confirm <orgId>
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import convexSchema from "../convex/schema";
import {
  DIRECT_TABLES,
  FILTER_TABLES,
  PARENT_JOIN,
  EXPECTED_TABLE_COUNT,
  assertCoverage,
} from "./org-export-tables";

const PAGE = 500;
const PARENT_CHUNK = 50;

function parseArgs(argv: string[]): { orgId?: string; confirm?: string } {
  const out: { orgId?: string; confirm?: string } = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--confirm") {
      out.confirm = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest[0]) out.orgId = rest[0];
  return out;
}

/** Delete every row of a DIRECT table for the org, paging until exhausted. */
async function eraseDirect(table: string, orgId: string): Promise<number> {
  let total = 0;
  for (;;) {
    const convex = await getConvexClient();
    const res = await convex.mutation(api.orgErasure.deleteTablePage, { table, orgId, numItems: PAGE });
    total += res.deleted;
    if (res.isDone) break;
  }
  return total;
}

/** Delete every row of a FILTER table for the org, paging until exhausted. */
async function eraseFiltered(table: string, orgId: string, orgField: string): Promise<number> {
  let total = 0;
  for (;;) {
    const convex = await getConvexClient();
    const res = await convex.mutation(api.orgErasure.deleteFilteredPage, { table, orgId, orgField, numItems: PAGE });
    total += res.deleted;
    if (res.isDone) break;
  }
  return total;
}

/** Delete every PARENT_JOIN child row by chunking parent cuid ids. */
async function eraseChildren(table: string, indexName: string, parentField: string, parentIds: string[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < parentIds.length; i += PARENT_CHUNK) {
    const chunk = parentIds.slice(i, i + PARENT_CHUNK);
    const convex = await getConvexClient();
    const res = await convex.mutation(api.orgErasure.deleteChildRowsByParentIds, {
      table,
      indexName,
      parentField,
      parentIds: chunk,
    });
    total += res.deleted;
  }
  return total;
}

async function main() {
  const { orgId, confirm } = parseArgs(process.argv.slice(2));
  if (!orgId) {
    throw new Error("Usage: scripts/erase-org.ts <orgId> --confirm <orgId>");
  }
  if (confirm !== orgId) {
    throw new Error(
      `Refusing to run: --confirm must exactly match the target orgId. Got --confirm ${confirm ?? "(missing)"}, expected ${orgId}.`,
    );
  }

  // ---- Coverage guard (fail loudly on any unclassified schema table) --------
  const schemaTables = Object.keys(convexSchema.tables);
  assertCoverage(schemaTables);
  if (schemaTables.length !== EXPECTED_TABLE_COUNT) {
    throw new Error(
      `Schema has ${schemaTables.length} tables, classification expects ${EXPECTED_TABLE_COUNT}. ` +
        `Reconcile scripts/org-export-tables.ts before erasing.`,
    );
  }
  console.log(`Coverage OK: all ${schemaTables.length} schema tables classified.`);

  // ---- Require the org to already be archived --------------------------------
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, archivedAt: true },
  });
  if (!org) throw new Error(`Organization not found: ${orgId}`);
  if (!org.archivedAt) {
    throw new Error(
      `Organization "${org.name}" (${orgId}) is not archived. Archive it first (admin UI) — ` +
        `erasure only ever runs on something already retired.`,
    );
  }
  console.log(`Erasing organization: ${org.name} (${orgId}), archived ${org.archivedAt.toISOString()}`);

  // ---- Storage bytes: delete BEFORE the storedFiles records that reference them
  const storedFilesRes = await eraseStoredFilesAndBlobs(orgId);
  console.log(`  STORAGE  ${storedFilesRes.blobsDeleted} blob(s), ${storedFilesRes.recordsDeleted} storedFiles record(s)`);

  // ---- PARENT_JOIN first (children before their DIRECT parents) -------------
  // Need each parent's cuid ids — read them via the export reader (still valid,
  // read-only) before that parent table is erased below.
  for (const { table, parentTable, index, field } of PARENT_JOIN) {
    const parentIds = await readParentCuidIds(parentTable, orgId);
    const deleted = await eraseChildren(table, index, field, parentIds);
    console.log(`  CHILD    ${table} (via ${parentTable}.${field}, ${parentIds.length} parents): ${deleted}`);
  }

  // ---- DIRECT -----------------------------------------------------------------
  for (const table of DIRECT_TABLES) {
    const deleted = await eraseDirect(table, orgId);
    console.log(`  DIRECT   ${table}: ${deleted}`);
  }

  // ---- FILTER (storedFiles already handled above) ----------------------------
  for (const { table, orgField } of FILTER_TABLES) {
    if (table === "storedFiles") continue;
    const deleted = await eraseFiltered(table, orgId, orgField);
    console.log(`  FILTER   ${table} (${orgField}): ${deleted}`);
  }

  // ---- Postgres: delete the Organization row (cascades Member/Invitation/etc.)
  await prisma.organization.delete({ where: { id: orgId } });
  console.log(`\nDeleted Postgres organization row (cascaded members/invitations/etc.)`);
  console.log(`\nErasure complete for ${orgId}.`);
}

/** Read a table's cuid ids for an org WITHOUT deleting — used to resolve
 *  PARENT_JOIN parent ids before the parent table itself is erased. */
async function readParentCuidIds(table: string, orgId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const convex = await getConvexClient();
    const res: { page: { id?: string }[]; isDone: boolean; continueCursor: string } = await convex.query(
      api.orgExport.exportTablePage,
      { table, orgId, cursor, numItems: PAGE },
    );
    for (const r of res.page) if (r.id) ids.push(r.id);
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  return ids;
}

/** storedFiles needs its blobs deleted before the records — handled as one
 *  unit rather than the generic eraseFiltered loop. Reads a page (to get the
 *  storageIds), deletes the blobs, then deletes that same page of records;
 *  repeats from the top (no cursor) until a page comes back short. */
async function eraseStoredFilesAndBlobs(orgId: string): Promise<{ blobsDeleted: number; recordsDeleted: number }> {
  let blobsDeleted = 0;
  let recordsDeleted = 0;
  for (;;) {
    const convex = await getConvexClient();
    const page: { page: { storageId?: string }[]; isDone: boolean } = await convex.query(
      api.orgExport.scanTableFiltered,
      { table: "storedFiles", orgId, orgField: "organizationId", cursor: null, numItems: PAGE },
    );
    const storageIds = page.page.map((r) => r.storageId).filter((x): x is string => !!x);
    if (storageIds.length > 0) {
      const blobRes = await convex.mutation(api.orgErasure.deleteStorageBlobs, { storageIds });
      blobsDeleted += blobRes.deleted;
    }
    const delRes = await convex.mutation(api.orgErasure.deleteFilteredPage, {
      table: "storedFiles",
      orgId,
      orgField: "organizationId",
      numItems: PAGE,
    });
    recordsDeleted += delRes.deleted;
    if (delRes.isDone) break;
  }
  return { blobsDeleted, recordsDeleted };
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });

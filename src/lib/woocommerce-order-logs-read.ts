import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Prisma } from "@/generated/prisma/client";
import { getProjectsByOrg } from "@/lib/projects-read";

/**
 * Server-side read helpers for the WooCommerce-order-log domain (bucket-2 of the
 * Convex domain-only decommission, Phase B). `wooCommerceOrderLog` is now Convex-only —
 * written via api.wooCommerceOrderLogs.* in src/server/woocommerce.ts (and the webhook
 * route) and backfilled by scripts/convex-backfill-woocommerce-order-logs.ts.
 *
 * These helpers read the Convex copy and shape it back into the Prisma-row form the
 * woocommerce server actions returned (epoch-ms → Date, absent optionals → null; the
 * `payload` / `matchResults` / `dateExtraction` JSON columns pass through untouched).
 *
 * `api.wooCommerceOrderLogs.list({ orgId })` returns every log for the org; the status
 * filter, `createdAt` desc ordering, pagination, and the `project` join the old Prisma
 * query applied are reproduced here in pure JS so they stay unit-testable with no
 * Prisma fallback on a miss. The project join now reads the (Convex) projects list.
 */

type RawWooCommerceOrderLog = Doc<"wooCommerceOrderLogs">;

const toDate = (value: number | undefined): Date | null =>
  typeof value === "number" ? new Date(value) : null;

export interface WooCommerceOrderLogProject {
  id: string;
  projectNumber: string;
  name: string;
}

export interface WooCommerceOrderLogRow {
  id: string;
  organizationId: string;
  wooOrderId: number;
  wooOrderNumber: string | null;
  status: string;
  projectId: string | null;
  clientId: string | null;
  payload: Prisma.JsonValue;
  errorMessage: string | null;
  matchResults: Prisma.JsonValue;
  dateExtraction: Prisma.JsonValue;
  createdAt: Date | null;
  project: WooCommerceOrderLogProject | null;
}

export function mapWooCommerceOrderLog(
  d: RawWooCommerceOrderLog,
  project: WooCommerceOrderLogProject | null,
): WooCommerceOrderLogRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    wooOrderId: d.wooOrderId,
    wooOrderNumber: d.wooOrderNumber ?? null,
    status: d.status,
    projectId: d.projectId ?? null,
    clientId: d.clientId ?? null,
    payload: d.payload,
    errorMessage: d.errorMessage ?? null,
    matchResults: d.matchResults ?? null,
    dateExtraction: d.dateExtraction ?? null,
    // Prisma column has @default(now()); Convex stores it as an optional.
    createdAt: toDate(d.createdAt),
    project,
  };
}

/**
 * Reproduce the old Prisma query (sans the project join, which the caller attaches):
 *   where:   { organizationId, status? }
 *   orderBy: { createdAt: "desc" }
 *   skip/take pagination
 *
 * `organizationId` is already satisfied by the Convex `list({ orgId })` query, so this
 * applies the optional status filter and the createdAt-desc ordering. Returns the
 * filtered+sorted full set; the caller slices for the requested page.
 */
export function filterAndSortOrderLogs(
  rows: WooCommerceOrderLogRow[],
  status?: string,
): WooCommerceOrderLogRow[] {
  return rows
    .filter((r) => (status ? r.status === status : true))
    .sort((a, b) => {
      const at = a.createdAt ? a.createdAt.getTime() : 0;
      const bt = b.createdAt ? b.createdAt.getTime() : 0;
      return bt - at; // createdAt desc
    });
}

/**
 * A page of order logs for an org — the Convex-read replacement for the paginated
 * Prisma `findMany` + `count` in `getWooCommerceOrderLogs`. Returns the slice plus the
 * total count of matching rows. The `project` join reads the org's (Convex) projects.
 */
export async function getWooCommerceOrderLogsPage(
  organizationId: string,
  opts: { page: number; pageSize: number; status?: string },
): Promise<{ items: WooCommerceOrderLogRow[]; total: number }> {
  const [rawRows, projects] = await Promise.all([
    withConvexReadRetry(async () =>
      (await getConvexClient()).query(api.wooCommerceOrderLogs.list, {
        orgId: organizationId,
      }),
    ) as Promise<RawWooCommerceOrderLog[]>,
    getProjectsByOrg(organizationId),
  ]);

  const projectMap = new Map<string, WooCommerceOrderLogProject>(
    projects.map((p) => [p.id, { id: p.id, projectNumber: p.projectNumber, name: p.name }]),
  );

  const mapped = rawRows.map((r) =>
    mapWooCommerceOrderLog(r, r.projectId ? projectMap.get(r.projectId) ?? null : null),
  );
  const filtered = filterAndSortOrderLogs(mapped, opts.status);

  const total = filtered.length;
  const start = (opts.page - 1) * opts.pageSize;
  const items = filtered.slice(start, start + opts.pageSize);
  return { items, total };
}

/**
 * A single FAILED log by id (org-scoped) — the Convex-read replacement for the Prisma
 * `findFirst({ where: { id, organizationId, status: "FAILED" } })` in `retryFailedOrder`.
 * The full row (incl. `payload`) is returned so the retry can re-process it.
 */
export async function getFailedOrderLogById(
  organizationId: string,
  logId: string,
): Promise<WooCommerceOrderLogRow | null> {
  const row = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.wooCommerceOrderLogs.getById, { id: logId }),
  )) as RawWooCommerceOrderLog | null;
  if (!row) return null;
  if (row.organizationId !== organizationId || row.status !== "FAILED") return null;
  return mapWooCommerceOrderLog(row, null);
}

/**
 * The first COMPLETED log for a given Woo order id (org-scoped) — the Convex-read
 * replacement for the webhook's idempotency `findFirst({ where: { organizationId,
 * wooOrderId, status: "COMPLETED" } })`. Returns null when no completed log exists.
 */
export async function findCompletedOrderLog(
  organizationId: string,
  wooOrderId: number,
): Promise<WooCommerceOrderLogRow | null> {
  const rawRows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.wooCommerceOrderLogs.list, {
      orgId: organizationId,
    }),
  )) as RawWooCommerceOrderLog[];
  const match = rawRows.find(
    (r) => r.wooOrderId === wooOrderId && r.status === "COMPLETED",
  );
  return match ? mapWooCommerceOrderLog(match, null) : null;
}

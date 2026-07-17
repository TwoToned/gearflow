import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the `testTagAuditorToken` domain (Phase B write
 * inversion, bucket-2). The table is CONVEX-ONLY now: every create/update/revoke/
 * delete writes the Convex `testTagAuditorTokens` doc as the sole source of truth
 * (no Prisma row, no mirror). No inbound Prisma FK → no FK-drop migration; the
 * Prisma `test_tag_auditor_token` table is left unwritten until Phase C drops it.
 *
 * These helpers read the Convex copy and shape it back into the Prisma-row form
 * the auditor-token server actions return (epoch-ms → Date, absent optionals →
 * null, Prisma-defaulted columns coerced non-null). The `createdBy` Auth User
 * join is attached in the server action.
 *
 * SECURITY: `validateAuditorToken` (the public auditor-portal endpoint) hashes
 * the raw token and looks it up by `tokenHash` (the old `@unique` column) via
 * `getAuditorTokenByHash` — the match + isActive + expiry semantics are preserved
 * in the server action. No Prisma fallback on a Convex miss.
 *
 * See FEATUREDOCS/54.
 */

type RawToken = Doc<"testTagAuditorTokens">;

const toDate = (v: number | undefined | null): Date | null =>
  typeof v === "number" ? new Date(v) : null;

export interface TestTagAuditorTokenRow {
  id: string;
  organizationId: string;
  name: string;
  token: string;
  tokenHash: string;
  // Prisma `@default(true)` — an absent Convex value means true.
  isActive: boolean;
  expiresAt: Date | null;
  scope: string | null;
  createdById: string;
  lastAccessedAt: Date | null;
  createdAt: Date | null;
}

export function mapAuditorToken(d: RawToken): TestTagAuditorTokenRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    token: d.token,
    tokenHash: d.tokenHash,
    isActive: d.isActive ?? true,
    expiresAt: toDate(d.expiresAt),
    scope: d.scope ?? null,
    createdById: d.createdById,
    lastAccessedAt: toDate(d.lastAccessedAt),
    createdAt: toDate(d.createdAt),
  };
}

/**
 * All auditor tokens for an org, newest first — replaces the Prisma
 * `findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })`.
 */
export async function getAuditorTokensByOrg(
  organizationId: string,
): Promise<TestTagAuditorTokenRow[]> {
  const rows = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.testTagAuditorTokens.list, {
      orgId: organizationId,
    }),
  )) as RawToken[];
  return rows
    .map(mapAuditorToken)
    .sort((a, b) => {
      const at = a.createdAt ? a.createdAt.getTime() : -Infinity;
      const bt = b.createdAt ? b.createdAt.getTime() : -Infinity;
      return bt - at; // desc
    });
}

/** Single token by cuid (no org scope at the index — caller enforces org). */
export async function getAuditorTokenById(
  id: string,
): Promise<TestTagAuditorTokenRow | null> {
  const doc = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.testTagAuditorTokens.getById, { id }),
  )) as RawToken | null;
  return doc ? mapAuditorToken(doc) : null;
}

/**
 * Secure lookup by SHA-256 `tokenHash` — the public auditor-portal validation
 * path. Replicates the old Prisma `findUnique({ where: { tokenHash } })`.
 */
export async function getAuditorTokenByHash(
  tokenHash: string,
): Promise<TestTagAuditorTokenRow | null> {
  const doc = (await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.testTagAuditorTokens.getByTokenHash, {
      tokenHash,
    }),
  )) as RawToken | null;
  return doc ? mapAuditorToken(doc) : null;
}

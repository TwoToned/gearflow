import { prisma } from "@/lib/prisma";

/**
 * Better Auth `User` lookups for attaching to Convex-sourced rows. Users are
 * auth-owned and stay in Prisma FOREVER (out of the Convex domain-only
 * decommission scope), so resolving names for `testedBy` / `approvedBy` /
 * `confirmedBy` cross-domain joins via Prisma is correct, not a leftover.
 */
export async function getUserMap(ids: Array<string | null | undefined>): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name }]));
}

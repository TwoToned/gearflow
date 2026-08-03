import { prisma } from "@/lib/prisma";

/**
 * Best-effort "some organization" lookup for platform-wide actions (site-admin
 * or auth-layer) that are NOT scoped to a single org but still need an
 * `organizationId` to satisfy `logActivity`'s schema. Arbitrary (oldest-
 * created) — the choice only affects which org's activity feed shows the
 * entry; these are platform-wide actions, not org actions. Real per-org
 * attribution for site-wide audit entries is unresolved by Phase A (#1064) —
 * flagged for a later platform-audit-log pass, not this one.
 */
export async function getAnyOrgForAudit() {
  return prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
}

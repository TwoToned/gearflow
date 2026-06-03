import { prisma } from "@/lib/prisma";
import { DEFAULT_DAYS_PER_BILLING_MONTH, resolveDaysPerMonth } from "@/lib/pricing";

import type { OrgSettings } from "@/server/settings";

type PrismaLike = { organization: typeof prisma.organization };

/**
 * Resolve the org-configured days-per-month. Falls back to the default (28) if
 * the org has no override, the metadata can't be parsed, or the stored value
 * is out of the allowed range.
 *
 * Accepts an optional transaction client so callers inside an interactive
 * `$transaction` can stay on the same connection.
 */
export async function getOrgDaysPerMonth(
  organizationId: string,
  client?: PrismaLike
): Promise<number> {
  const db = client ?? prisma;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { metadata: true },
  });

  if (!org?.metadata) return DEFAULT_DAYS_PER_BILLING_MONTH;

  try {
    const settings = JSON.parse(org.metadata) as Partial<OrgSettings>;
    return resolveDaysPerMonth(settings.daysPerMonth);
  } catch {
    return DEFAULT_DAYS_PER_BILLING_MONTH;
  }
}

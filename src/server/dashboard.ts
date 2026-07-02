"use server";

import { getOrgContext } from "@/lib/org-context";
import { attachClient } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";
import {
  getLineItemsByProjectIds,
  countEquipmentLineItemsByProject,
} from "@/lib/line-item-count-read";
import { getProjectsByOrg, getProjectIdsForManager } from "@/lib/projects-read";

/**
 * User-centric home data: the projects the current user manages (as the single
 * projectManager OR via the ProjectManager join), plus their org's display name.
 * Active projects only (not completed/invoiced/cancelled), soonest first.
 */
export async function getMyHomeData() {
  const { organizationId, userId, userName } = await getOrgContext();

  const INACTIVE_STATUSES = new Set(["COMPLETED", "INVOICED", "CANCELLED"]);
  const [allProjects, pmProjectIds] = await Promise.all([
    getProjectsByOrg(organizationId),
    getProjectIdsForManager(organizationId, userId),
  ]);

  const candidateProjects = allProjects
    .filter(
      (p) =>
        !p.isTemplate &&
        !INACTIVE_STATUSES.has(p.status ?? "") &&
        (p.projectManagerId === userId || pmProjectIds.has(p.id)),
    )
    .sort((a, b) => {
      if (a.rentalStartDate && b.rentalStartDate) return (a.rentalStartDate as number) - (b.rentalStartDate as number);
      if (a.rentalStartDate) return -1;
      if (b.rentalStartDate) return 1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    })
    .slice(0, 24);

  const projectIds = candidateProjects.map((p) => p.id);
  const homeLineItems = await getLineItemsByProjectIds(organizationId, projectIds);
  const liCountMap = countEquipmentLineItemsByProject(homeLineItems, projectIds);
  const myProjects = candidateProjects.map((p) => ({ ...p, _count: { lineItems: liCountMap.get(p.id) ?? 0 } }));

  // Clients live in Convex — attach instead of a Prisma join.
  const withClients = await attachClient(organizationId, myProjects);
  return serialize({ userName, userId, myProjects: withClients });
}


"use server";

import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org-context";
import { getClientById } from "@/lib/clients-read";
import { serialize } from "@/lib/serialize";

export async function getProjectForDocument(projectId: string) {
  const { organizationId } = await getOrgContext();

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  const projectRow = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      location: true,
      lineItems: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { sortOrder: "asc" },
        include: {
          model: { include: { category: true } },
          asset: true,
          bulkAsset: true,
        },
      },
    },
  });

  if (!projectRow) throw new Error("Project not found");

  // Clients live in Convex — attach instead of a Prisma join.
  const project = {
    ...projectRow,
    client: projectRow.clientId ? await getClientById(projectRow.clientId) : null,
  };

  let orgSettings: Record<string, unknown> = {};
  if (org?.metadata) {
    try {
      orgSettings = JSON.parse(org.metadata);
    } catch {
      // ignore
    }
  }

  return serialize({
    org: {
      name: org?.name || "",
      ...orgSettings,
    },
    project,
  });
}

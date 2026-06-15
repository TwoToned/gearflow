/**
 * Pure operational-P&L logic. Lives outside `"use server"` so it can be
 * imported and exercised by integration tests directly with a known orgId.
 * The server-action wrapper at `src/server/project-costs.ts` resolves
 * `organizationId` via the session and delegates here.
 */

import { prisma } from "@/lib/prisma";
import { getProjectById } from "@/lib/projects-read";

export interface ProjectOperationalCosts {
  equipmentRevenue: number;
  serviceRevenue: number;
  total: number;
  serviceCostTotal: number;
  labourCostTotal: number;
  subHireCostTotal: number;
  maintenanceCostTotal: number;
  damageCostTotal: number;
  damageChargedBackTotal: number;
  netMargin: number;
  marginPercent: number;
  counts: {
    maintenanceRecords: number;
    damageEvents: number;
  };
}

export async function computeProjectOperationalCosts(
  projectId: string,
  organizationId: string,
): Promise<ProjectOperationalCosts> {
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) return emptyResult();

  const serviceRevenueAgg = await prisma.projectService.aggregate({
    where: { projectId, organizationId, status: { not: "CANCELLED" }, showOnDocuments: true },
    _sum: { lineTotal: true },
  });

  const maintenanceAgg = await prisma.maintenanceRecord.aggregate({
    where: { projectId, organizationId, status: { notIn: ["CANCELLED"] } },
    _sum: { cost: true },
    _count: true,
  });

  const damageRows = await prisma.damageEvent.findMany({
    where: { projectId, organizationId },
    select: { actualCost: true, estimatedCost: true, chargedBack: true },
  });

  let damageCostTotal = 0;
  let damageChargedBackTotal = 0;
  for (const d of damageRows) {
    const cost = d.actualCost != null
      ? Number(d.actualCost)
      : d.estimatedCost != null
        ? Number(d.estimatedCost)
        : 0;
    damageCostTotal += cost;
    if (d.chargedBack) damageChargedBackTotal += cost;
  }

  const equipmentRevenue = Number(project.equipmentRevenue ?? 0);
  const serviceRevenue = Number(serviceRevenueAgg._sum.lineTotal ?? 0);
  const total = Number(project.total ?? 0);
  const serviceCostTotal = Number(project.serviceCostTotal ?? 0);
  const labourCostTotal = Number(project.labourCostTotal ?? 0);
  const subHireCostTotal = Number(project.subHireCostTotal ?? 0);
  const maintenanceCostTotal = Number(maintenanceAgg._sum.cost ?? 0);

  // Charged-back damage isn't our cost — the client pays for it.
  const ourDamage = damageCostTotal - damageChargedBackTotal;
  const allCosts =
    serviceCostTotal + labourCostTotal + subHireCostTotal + maintenanceCostTotal + ourDamage;

  const netMargin = total - allCosts;
  const marginPercent = total > 0 ? Math.max(0, Math.min(100, (netMargin / total) * 100)) : 0;

  return {
    equipmentRevenue,
    serviceRevenue,
    total,
    serviceCostTotal,
    labourCostTotal,
    subHireCostTotal,
    maintenanceCostTotal,
    damageCostTotal,
    damageChargedBackTotal,
    netMargin,
    marginPercent,
    counts: {
      maintenanceRecords: maintenanceAgg._count,
      damageEvents: damageRows.length,
    },
  };
}

function emptyResult(): ProjectOperationalCosts {
  return {
    equipmentRevenue: 0,
    serviceRevenue: 0,
    total: 0,
    serviceCostTotal: 0,
    labourCostTotal: 0,
    subHireCostTotal: 0,
    maintenanceCostTotal: 0,
    damageCostTotal: 0,
    damageChargedBackTotal: 0,
    netMargin: 0,
    marginPercent: 0,
    counts: { maintenanceRecords: 0, damageEvents: 0 },
  };
}

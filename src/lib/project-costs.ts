/**
 * Pure operational-P&L logic. Lives outside `"use server"` so it can be
 * imported and exercised by integration tests directly with a known orgId.
 * The server-action wrapper at `src/server/project-costs.ts` resolves
 * `organizationId` via the session and delegates here.
 */

import { getProjectById } from "@/lib/projects-read";
import { getProjectServicesByOrg, sumProjectServiceRevenue, sumProjectLabourServiceRevenue } from "@/lib/project-services-read";
import { getMaintenanceRecordsByOrg, aggregateMaintenanceForProject } from "@/lib/maintenance-read";

/** `Number(v ?? 0)`, factored into its own function so `computeProjectOperationalCosts`'s
 *  cyclomatic complexity isn't paying for every field's null-coalesce (R-3.6). */
const num = (v: unknown): number => (v != null ? Number(v) : 0);

export interface ProjectOperationalCosts {
  equipmentRevenue: number;
  /** WS11 (#950) — see convex/projectCosts.ts's costsShape comment. */
  saleRevenue: number;
  saleCostTotal: number;
  serviceRevenue: number;
  /** WS10 #949 — see convex/projectCosts.ts's costsShape comment. */
  labourServiceRevenue: number;
  total: number;
  serviceCostTotal: number;
  labourCostTotal: number;
  subHireCostTotal: number;
  maintenanceCostTotal: number;
  netMargin: number;
  marginPercent: number;
  counts: {
    maintenanceRecords: number;
  };
}

export async function computeProjectOperationalCosts(
  projectId: string,
  organizationId: string,
): Promise<ProjectOperationalCosts> {
  const project = await getProjectById(projectId);
  if (!project || project.organizationId !== organizationId) return emptyResult();

  // projectService + maintenanceRecord are dual-written — aggregate from Convex.
  const [orgServices, orgMaintenance] = await Promise.all([
    getProjectServicesByOrg(organizationId),
    getMaintenanceRecordsByOrg(organizationId),
  ]);
  const serviceRevenueTotal = sumProjectServiceRevenue(orgServices, projectId);
  const labourServiceRevenue = sumProjectLabourServiceRevenue(orgServices, projectId);
  const maintenanceAgg = aggregateMaintenanceForProject(orgMaintenance, projectId);

  const equipmentRevenue = num(project.equipmentRevenue);
  // WS11 (#950) — persisted by recalcProjectTotals (convex/lib/recalc.ts),
  // same pattern as equipmentRevenue/total/etc. above.
  const saleRevenue = num(project.saleRevenue);
  const saleCostTotal = num(project.saleCostTotal);
  const serviceRevenue = serviceRevenueTotal;
  const total = num(project.total);
  const serviceCostTotal = num(project.serviceCostTotal);
  const labourCostTotal = num(project.labourCostTotal);
  const subHireCostTotal = num(project.subHireCostTotal);
  const maintenanceCostTotal = maintenanceAgg.costTotal;

  const allCosts =
    serviceCostTotal + labourCostTotal + subHireCostTotal + maintenanceCostTotal + saleCostTotal;

  const netMargin = total - allCosts;
  const marginPercent = total > 0 ? Math.max(0, Math.min(100, (netMargin / total) * 100)) : 0;

  return {
    equipmentRevenue,
    saleRevenue,
    saleCostTotal,
    serviceRevenue,
    labourServiceRevenue,
    total,
    serviceCostTotal,
    labourCostTotal,
    subHireCostTotal,
    maintenanceCostTotal,
    netMargin,
    marginPercent,
    counts: {
      maintenanceRecords: maintenanceAgg.count,
    },
  };
}

function emptyResult(): ProjectOperationalCosts {
  return {
    equipmentRevenue: 0,
    saleRevenue: 0,
    saleCostTotal: 0,
    serviceRevenue: 0,
    labourServiceRevenue: 0,
    total: 0,
    serviceCostTotal: 0,
    labourCostTotal: 0,
    subHireCostTotal: 0,
    maintenanceCostTotal: 0,
    netMargin: 0,
    marginPercent: 0,
    counts: { maintenanceRecords: 0 },
  };
}

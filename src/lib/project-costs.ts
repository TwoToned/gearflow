/**
 * The operational-P&L shape `projectCosts.operationalCosts` returns (the Convex query is
 * the only implementation; `netMargin` / `marginPercent` are EX GST there, on the same
 * base as `projects.margin`, see `convex/lib/margin.ts`). The old client-side
 * `computeProjectOperationalCosts` had no callers and a GST-inclusive copy of the margin
 * formula, so it was deleted rather than kept in sync (R-3.1).
 */
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

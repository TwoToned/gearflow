/**
 * Migration parity gate: compare Prisma row counts to Convex doc counts for every
 * dual-written table. The go/no-go check after a full backfill.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-parity-check.ts
 *
 * Exit 0 = every table matches. Exit 1 = at least one mismatch (or error). Prints
 * a per-table table with Prisma / Convex / delta.
 *
 * Convex counts are obtained by paging `api.parity.countPage` (the per-query read
 * limit means a single count query can't scan a big table). The pair list below is
 * the authoritative set of dual-written tables — keep it in sync with the
 * `convex-backfill-*` scripts and src/lib/*-mirror.ts. Tables with a mirror but no
 * dedicated backfill (line-item units, project managers/services/tasks) are
 * included on purpose: a mismatch there is the signal that they still need a
 * historical backfill.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

// [Prisma client accessor, Convex table name]
const PAIRS: Array<[string, string]> = [
  // reference / config
  ["client", "clients"],
  ["supplier", "suppliers"],
  ["location", "locations"],
  ["model", "models"],
  ["category", "categories"],
  ["checkItem", "checkItems"],
  ["modelCheckItem", "modelCheckItems"],
  ["kitCheckItem", "kitCheckItems"],
  ["customFieldDefinition", "customFieldDefinitions"],
  ["testProfile", "testProfiles"],
  ["brandTemplate", "brandTemplates"],
  ["groupTemplate", "groupTemplates"],
  ["sectionPreset", "sectionPresets"],
  ["documentTemplate", "documentTemplates"],
  ["serviceTemplate", "serviceTemplates"],
  ["fileUpload", "fileUploads"],
  // crew
  ["crewMember", "crewMembers"],
  ["crewRole", "crewRoles"],
  ["crewSkill", "crewSkills"],
  ["crewAssignment", "crewAssignments"],
  ["crewShift", "crewShifts"],
  ["crewAvailability", "crewAvailabilities"],
  ["crewCertification", "crewCertifications"],
  ["crewTimeEntry", "crewTimeEntries"],
  // central graph
  ["project", "projects"],
  ["projectCategory", "projectCategories"],
  ["projectGroup", "projectGroups"],
  ["projectManager", "projectManagers"],
  ["projectService", "projectServices"],
  ["projectTask", "projectTasks"],
  ["projectLineItem", "projectLineItems"],
  ["projectLineItemUnit", "projectLineItemUnits"],
  ["asset", "assets"],
  ["bulkAsset", "bulkAssets"],
  ["kit", "kits"],
  ["kitSerializedItem", "kitSerializedItems"],
  ["kitBulkItem", "kitBulkItems"],
  // transactional
  ["subHire", "subHires"],
  ["subHireItem", "subHireItems"],
  ["subHireGroup", "subHireGroups"],
  ["supplierOrder", "supplierOrders"],
  ["supplierOrderItem", "supplierOrderItems"],
  ["damageEvent", "damageEvents"],
  ["maintenanceRecord", "maintenanceRecords"],
  ["stocktake", "stocktakes"],
  ["stocktakeItem", "stocktakeItems"],
  ["warehouseClose", "warehouseCloses"],
  ["savedReport", "savedReports"],
  ["savedTableView", "savedTableViews"],
  // media
  ["assetMedia", "assetMedia"],
  ["modelMedia", "modelMedia"],
  ["kitMedia", "kitMedia"],
  ["projectMedia", "projectMedia"],
  ["clientMedia", "clientMedia"],
  ["locationMedia", "locationMedia"],
  ["subHireMedia", "subHireMedia"],
  // accessory joins + supplier rates + event tables (Phase 6 sub-table dual-write)
  ["assetBulkChild", "assetBulkChildren"],
  ["modelBulkAccessory", "modelBulkAccessories"],
  ["supplierModelRate", "supplierModelRates"],
  ["assetScanLog", "assetScanLogs"],
  ["checkRecord", "checkRecords"],
];

async function convexCount(table: string): Promise<number> {
  const convex = await getConvexClient();
  let total = 0;
  let cursor: string | null = null;
  // Page until done. countPage returns at most 2000 ids/page.
  for (;;) {
    const res: { count: number; isDone: boolean; continueCursor: string } =
      await convex.query(api.parity.countPage, { table, cursor });
    total += res.count;
    if (res.isDone) break;
    cursor = res.continueCursor;
  }
  return total;
}

async function main() {
  const rows: Array<{ table: string; prisma: number; convex: number; ok: boolean }> = [];
  let mismatches = 0;

  for (const [model, table] of PAIRS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[model];
    if (!delegate?.count) {
      console.warn(`  ! skip ${table} — no prisma.${model} delegate`);
      continue;
    }
    const [prismaCount, cv] = await Promise.all([
      delegate.count() as Promise<number>,
      convexCount(table).catch((e) => {
        console.warn(`  ! convex count failed for ${table}: ${(e as Error).message}`);
        return -1;
      }),
    ]);
    const ok = cv === prismaCount;
    if (!ok) mismatches++;
    rows.push({ table, prisma: prismaCount, convex: cv, ok });
  }

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log("\n" + pad("TABLE", 26) + pad("PRISMA", 10) + pad("CONVEX", 10) + "STATUS");
  console.log("-".repeat(54));
  for (const r of rows) {
    console.log(
      pad(r.table, 26) + pad(r.prisma, 10) + pad(r.convex < 0 ? "ERR" : r.convex, 10) + (r.ok ? "OK" : "✗ MISMATCH"),
    );
  }
  console.log("-".repeat(54));
  console.log(`${rows.length} tables, ${mismatches} mismatch(es).`);

  await prisma.$disconnect();
  process.exit(mismatches > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Dev seed — Test & Tag (T&T) data for validating the Phase A read-rewiring of
 * `src/server/test-tag-reports.ts` against Convex.
 *
 * Creates a realistic, varied set: one serialized asset + one bulk asset (so the
 * `assetLinkType` filter has serialized/bulk/standalone cases), a test profile,
 * ~7 testTagAssets across every equipmentClass / applianceType / status, and
 * several testTagRecords (PASS/FAIL, two testers, a date range) with sub-test
 * records on the failing ones.
 *
 * Idempotent: keyed off the seed prefix. Re-running is a no-op. After this, run
 * `convex:backfill:all` to mirror into Convex.
 *
 *   npx tsx --env-file=.env scripts/seed-test-tag-dev.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PFX = "TTSEED";
const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const d = (offsetDays: number) => new Date(now + offsetDays * day);

async function main() {
  console.log("[tt-seed] starting");
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("[tt-seed] no organization — bootstrap one first");
  const orgId = org.id;
  console.log(`[tt-seed] org ${org.name} (${orgId})`);

  const users = await prisma.user.findMany({ take: 2, orderBy: { createdAt: "asc" } });
  if (users.length === 0) throw new Error("[tt-seed] no users");
  const tester1 = users[0];
  const tester2 = users[1] ?? users[0];

  const models = await prisma.model.findMany({ where: { organizationId: orgId }, take: 2 });
  if (models.length === 0) throw new Error("[tt-seed] no models — run `npm run seed` first");
  const serialModel = models[0];
  const bulkModel = models[models.length - 1];

  // ── serialized + bulk assets (for the link-type cases) ────────────────────
  const asset = await prisma.asset.upsert({
    where: { organizationId_assetTag: { organizationId: orgId, assetTag: `${PFX}-A1` } },
    update: {},
    create: { organizationId: orgId, modelId: serialModel.id, assetTag: `${PFX}-A1`, status: "AVAILABLE" },
  });
  const bulkAsset = await prisma.bulkAsset.upsert({
    where: { organizationId_assetTag: { organizationId: orgId, assetTag: `${PFX}-B1` } },
    update: {},
    create: { organizationId: orgId, modelId: bulkModel.id, assetTag: `${PFX}-B1`, totalQuantity: 10 },
  });

  // ── test profile ──────────────────────────────────────────────────────────
  const existingProfile = await prisma.testProfile.findFirst({ where: { organizationId: orgId, name: `${PFX} Profile` } });
  const profile = existingProfile ?? (await prisma.testProfile.create({
    data: {
      organizationId: orgId, name: `${PFX} Profile`, equipmentClass: "CLASS_I",
      applianceType: "APPLIANCE", requiresSubTests: false, defaultSubTestCount: 0,
      isDefault: false, isActive: true,
      visualChecks: [], electricalTests: [], thresholds: {},
    },
  }));

  // ── testTagAssets: varied class / type / status / link ────────────────────
  type TT = {
    sfx: string; description: string; equipmentClass: string; applianceType: string;
    status: string; assetId?: string; bulkAssetId?: string; location?: string;
    make?: string; modelName?: string; serialNumber?: string; isActive?: boolean;
    lastTestDate?: Date | null; nextDueDate?: Date | null;
  };
  const defs: TT[] = [
    { sfx: "001", description: "Powered speaker", equipmentClass: "CLASS_I", applianceType: "APPLIANCE", status: "CURRENT", assetId: asset.id, location: "Warehouse A", make: "Acme", modelName: "X1", serialNumber: "SN001", lastTestDate: d(-30), nextDueDate: d(335) },
    { sfx: "002", description: "Power board 4-way", equipmentClass: "CLASS_II", applianceType: "POWER_BOARD", status: "DUE_SOON", location: "Warehouse A", make: "Hpm", modelName: "PB4", lastTestDate: d(-340), nextDueDate: d(20) },
    { sfx: "003", description: "Extension lead 10m", equipmentClass: "CLASS_I", applianceType: "EXTENSION_LEAD", status: "OVERDUE", bulkAssetId: bulkAsset.id, location: "Truck 1", lastTestDate: d(-400), nextDueDate: d(-35) },
    { sfx: "004", description: "IEC cord", equipmentClass: "LEAD_CORD_ASSEMBLY", applianceType: "CORD_SET", status: "FAILED", location: "Truck 1", make: "Generic", modelName: "C13", serialNumber: "SN004", lastTestDate: d(-10), nextDueDate: d(355) },
    { sfx: "005", description: "Microwave oven", equipmentClass: "CLASS_II_DOUBLE_INSULATED", applianceType: "MICROWAVE", status: "NOT_YET_TESTED", location: "Office" },
    { sfx: "006", description: "Portable RCD", equipmentClass: "CLASS_I", applianceType: "RCD_PORTABLE", status: "CURRENT", location: "Office", lastTestDate: d(-15), nextDueDate: d(350) },
    { sfx: "007", description: "Retired blender", equipmentClass: "CLASS_II", applianceType: "APPLIANCE", status: "RETIRED", isActive: false, location: "Office", lastTestDate: d(-500), nextDueDate: d(-100) },
  ];

  const ttMap = new Map<string, { id: string }>();
  for (const t of defs) {
    const testTagId = `${PFX}-${t.sfx}`;
    const row = await prisma.testTagAsset.upsert({
      where: { organizationId_testTagId: { organizationId: orgId, testTagId } },
      update: {},
      create: {
        organizationId: orgId, testTagId, description: t.description,
        equipmentClass: t.equipmentClass as never, applianceType: t.applianceType as never,
        status: t.status as never, testIntervalMonths: 12, isActive: t.isActive ?? true,
        assetId: t.assetId, bulkAssetId: t.bulkAssetId, location: t.location,
        make: t.make, modelName: t.modelName, serialNumber: t.serialNumber,
        testProfileId: profile.id, lastTestDate: t.lastTestDate ?? null, nextDueDate: t.nextDueDate ?? null,
      },
    });
    ttMap.set(t.sfx, row);
  }

  // ── testTagRecords (+ sub-tests on failures) ──────────────────────────────
  type REC = {
    sfx: string; ttSfx: string; testDate: Date; testedById: string; testerName: string;
    result: string; visual: string; earth: string; insulation: string; leakage: string;
    polarity: string; rcd: string; functional: string; failureAction: string;
    earthReading?: number; insulationReading?: number; leakageReading?: number;
    failureNotes?: string; subs?: { label: string; result: string; earthReading?: number; insulationReading?: number }[];
  };
  const recs: REC[] = [
    { sfx: "R1", ttSfx: "001", testDate: d(-30), testedById: tester1.id, testerName: tester1.name, result: "PASS", visual: "PASS", earth: "PASS", insulation: "PASS", leakage: "PASS", polarity: "PASS", rcd: "NOT_APPLICABLE", functional: "PASS", failureAction: "NONE", earthReading: 0.12, insulationReading: 250 },
    { sfx: "R2", ttSfx: "001", testDate: d(-395), testedById: tester2.id, testerName: tester2.name, result: "PASS", visual: "PASS", earth: "PASS", insulation: "PASS", leakage: "PASS", polarity: "PASS", rcd: "NOT_APPLICABLE", functional: "PASS", failureAction: "NONE" },
    { sfx: "R3", ttSfx: "003", testDate: d(-400), testedById: tester1.id, testerName: tester1.name, result: "PASS", visual: "PASS", earth: "PASS", insulation: "PASS", leakage: "PASS", polarity: "PASS", rcd: "NOT_APPLICABLE", functional: "PASS", failureAction: "NONE" },
    { sfx: "R4", ttSfx: "004", testDate: d(-10), testedById: tester2.id, testerName: tester2.name, result: "FAIL", visual: "FAIL", earth: "FAIL", insulation: "PASS", leakage: "PASS", polarity: "PASS", rcd: "NOT_APPLICABLE", functional: "PASS", failureAction: "REMOVED_FROM_SERVICE", failureNotes: "Frayed cord", earthReading: 2.5, subs: [ { label: "Outlet 1", result: "FAIL", earthReading: 2.5 }, { label: "Outlet 2", result: "PASS", earthReading: 0.1 } ] },
    { sfx: "R5", ttSfx: "006", testDate: d(-15), testedById: tester1.id, testerName: tester1.name, result: "PASS", visual: "PASS", earth: "PASS", insulation: "PASS", leakage: "PASS", polarity: "PASS", rcd: "PASS", functional: "PASS", failureAction: "NONE" },
  ];

  for (const r of recs) {
    const tt = ttMap.get(r.ttSfx);
    if (!tt) continue;
    // idempotency: skip if a record already exists for this asset at this testDate
    const existing = await prisma.testTagRecord.findFirst({
      where: { testTagAssetId: tt.id, testDate: r.testDate },
    });
    if (existing) continue;
    await prisma.testTagRecord.create({
      data: {
        organizationId: orgId, testTagAssetId: tt.id, testProfileId: profile.id,
        testDate: r.testDate, testedById: r.testedById, testerName: r.testerName,
        result: r.result as never, visualInspectionResult: r.visual as never,
        equipmentClassTested: "CLASS_I", testMethod: "BOTH",
        earthContinuityResult: r.earth as never, earthContinuityReading: r.earthReading ?? null,
        insulationResult: r.insulation as never, insulationReading: r.insulationReading ?? null,
        leakageCurrentResult: r.leakage as never, leakageCurrentReading: r.leakageReading ?? null,
        polarityResult: r.polarity as never, rcdTripTimeResult: r.rcd as never,
        functionalTestResult: r.functional as never, failureAction: r.failureAction as never,
        failureNotes: r.failureNotes ?? null, nextDueDate: d(355),
        subTestRecords: r.subs ? {
          create: r.subs.map((s, i) => ({
            label: s.label, sortOrder: i, result: s.result as never,
            earthContinuityResult: (s.result === "FAIL" ? "FAIL" : "PASS") as never,
            earthContinuityReading: s.earthReading ?? null,
            insulationResult: "PASS" as never, insulationReading: s.insulationReading ?? null,
            leakageCurrentResult: "PASS" as never, polarityResult: "PASS" as never,
          })),
        } : undefined,
      },
    });
  }

  const counts = {
    testProfiles: await prisma.testProfile.count({ where: { organizationId: orgId } }),
    testTagAssets: await prisma.testTagAsset.count({ where: { organizationId: orgId } }),
    testTagRecords: await prisma.testTagRecord.count({ where: { organizationId: orgId } }),
    subTestRecords: await prisma.subTestRecord.count(),
  };
  console.log("[tt-seed] done:", JSON.stringify(counts));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Dev seed — adds a realistic mixed-type project to the dev DB so the
 * cross-type unification work has something meaningful to render against.
 *
 * Idempotent: keyed off the project name. Running twice is a no-op.
 *
 * Run with: `npm run seed`.
 *
 * Matches the locked test fixture from the autoplan test plan
 * (~/.gstack/projects/TwoToned-gearflow/jayden-main-test-plan-20260603-164457.md
 *  §"Test Fixture — Mixed-Type Project") so dev parity with the integration
 * suite once that's runnable.
 */

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const PROJECT_NAME = "Test Mixed Project (autoplan fixture)";

async function main() {
  console.log("[seed] starting");

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("[seed] no organization found — bootstrap an org first via /onboarding");
    process.exit(1);
  }
  console.log(`[seed] org: ${org.name} (${org.id})`);

  // Need an owner/admin to satisfy SubHire.createdById. Prefer the org's first owner.
  const member = await prisma.member.findFirst({
    where: { organizationId: org.id, role: "owner" },
    orderBy: { createdAt: "asc" },
  });
  const creatorUserId = member?.userId ?? (await prisma.user.findFirst())?.id;
  if (!creatorUserId) {
    console.error("[seed] no user found to attribute as createdBy");
    process.exit(1);
  }
  console.log(`[seed] createdBy user: ${creatorUserId}`);

  const existing = await prisma.project.findFirst({
    where: { organizationId: org.id, name: PROJECT_NAME },
  });
  if (existing) {
    console.log(`[seed] project "${PROJECT_NAME}" already exists (${existing.id}) — skipping`);
    process.exit(0);
  }

  await prisma.$transaction(async (tx) => {
    // ── Models (find or create) ───────────────────────────────────────
    const ulxd4 = await upsertModel(tx, org.id, "Shure ULXD4 (seed)", 60, 240);
    const ew100 = await upsertModel(tx, org.id, "Sennheiser EW100 (seed)", 40, 160);
    const macAura = await upsertModel(tx, org.id, "Martin MAC Aura PXL (seed)", 80, 320);
    const robe = await upsertModel(tx, org.id, "Robe Spiider (seed)", 90, 360);
    const truss = await upsertModel(tx, org.id, "Doughty 7m truss (seed)", 25, 100);

    // ── Supplier (find or create) ─────────────────────────────────────
    const supplier =
      (await tx.supplier.findFirst({
        where: { organizationId: org.id, name: "Test Sub-Hire Supplier (seed)" },
      })) ??
      (await tx.supplier.create({
        data: {
          organizationId: org.id,
          name: "Test Sub-Hire Supplier (seed)",
          contactName: "Sub Co.",
          email: "subhire@test.local",
        },
      }));

    // ── Project ───────────────────────────────────────────────────────
    const lastNumber = await tx.project.findFirst({
      where: { organizationId: org.id, projectNumber: { startsWith: "P-" } },
      orderBy: { projectNumber: "desc" },
      select: { projectNumber: true },
    });
    const nextSeq = lastNumber
      ? Number((lastNumber.projectNumber.match(/\d+$/) ?? ["0"])[0]) + 1
      : 1;
    const projectNumber = `P-${String(nextSeq).padStart(4, "0")}`;

    const project = await tx.project.create({
      data: {
        organizationId: org.id,
        projectNumber,
        name: PROJECT_NAME,
        status: "CONFIRMED",
        type: "CORPORATE",
        rentalStartDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        rentalEndDate: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
        billingDays: 3,
        description:
          "Cross-type unification fixture. Own stock + sub-hires + customs in two categories + one uncategorised sub-hire group.",
      },
    });
    console.log(`[seed] created project ${project.projectNumber}: ${project.name}`);

    // ── Category A: Stage Audio ───────────────────────────────────────
    const catAudio = await tx.projectCategory.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: "Stage Audio",
        sortOrder: 0,
      },
    });

    const groupMics = await tx.projectGroup.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catAudio.id,
        title: "Wireless mics",
        quantity: 1,
        price: 400,
        sortOrder: 0,
      },
    });

    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catAudio.id,
        groupId: groupMics.id,
        modelId: ulxd4.id,
        description: ulxd4.name,
        type: "EQUIPMENT",
        quantity: 2,
        unitPrice: 60,
        sortOrder: 0,
      },
    });
    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catAudio.id,
        groupId: groupMics.id,
        modelId: ew100.id,
        description: ew100.name,
        type: "EQUIPMENT",
        quantity: 4,
        unitPrice: 40,
        sortOrder: 1,
      },
    });

    // Sub-hire targeted at Stage Audio with one group + one ungrouped item
    const subHireAudio = await tx.subHire.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        supplierId: supplier.id,
        createdById: creatorUserId,
        orderNumber: `SO-${projectNumber}-A`,
        status: "CONFIRMED",
        defaultTargetCategoryId: catAudio.id,
      },
    });
    const shGroupSmoke = await tx.subHireGroup.create({
      data: {
        subHireId: subHireAudio.id,
        title: "Smoke machines",
        quantity: 1,
        cost: 80,
        charge: 200,
        targetCategoryId: catAudio.id,
        sortOrder: 0,
      },
    });
    await tx.subHireItem.create({
      data: {
        subHireId: subHireAudio.id,
        groupId: shGroupSmoke.id,
        description: "DJ Power V-12 (seed)",
        quantity: 2,
        unitCost: 30,
        unitCharge: 80,
        sortOrder: 0,
      },
    });
    await tx.subHireItem.create({
      data: {
        subHireId: subHireAudio.id,
        groupId: shGroupSmoke.id,
        description: "Antari Z-3000 (seed)",
        quantity: 1,
        unitCost: 40,
        unitCharge: 100,
        sortOrder: 1,
      },
    });

    // Custom item in Stage Audio (no group)
    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catAudio.id,
        isCustomItem: true,
        description: "Borrowed cable drum (seed)",
        type: "EQUIPMENT",
        quantity: 1,
        unitPrice: 50,
        pricingType: "FLAT",
        sortOrder: 0,
      },
    });

    // ── Category B: Stage Lighting ───────────────────────────────────
    const catLighting = await tx.projectCategory.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        name: "Stage Lighting",
        sortOrder: 1,
      },
    });

    const groupLighting = await tx.projectGroup.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catLighting.id,
        title: "Movers + truss",
        quantity: 1,
        price: 800,
        sortOrder: 0,
      },
    });

    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catLighting.id,
        groupId: groupLighting.id,
        modelId: macAura.id,
        description: macAura.name,
        type: "EQUIPMENT",
        quantity: 4,
        unitPrice: 80,
        sortOrder: 0,
      },
    });
    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catLighting.id,
        groupId: groupLighting.id,
        modelId: robe.id,
        description: robe.name,
        type: "EQUIPMENT",
        quantity: 2,
        unitPrice: 90,
        sortOrder: 1,
      },
    });
    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        categoryId: catLighting.id,
        groupId: groupLighting.id,
        modelId: truss.id,
        description: truss.name,
        type: "EQUIPMENT",
        quantity: 1,
        unitPrice: 25,
        sortOrder: 2,
      },
    });

    // ── Uncategorised: one standalone + one NULL-category sub-hire group ─
    await tx.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        description: "Backup spare (seed standalone, uncategorised)",
        isCustomItem: true,
        type: "EQUIPMENT",
        quantity: 1,
        unitPrice: 20,
        pricingType: "FLAT",
        sortOrder: 0,
      },
    });

    const subHireOrphan = await tx.subHire.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        supplierId: supplier.id,
        createdById: creatorUserId,
        orderNumber: `SO-${projectNumber}-B`,
        status: "DRAFT",
      },
    });
    const shGroupOrphan = await tx.subHireGroup.create({
      data: {
        subHireId: subHireOrphan.id,
        title: "Last-minute hire (uncategorised)",
        quantity: 1,
        cost: 50,
        charge: 120,
        sortOrder: 0,
      },
    });
    await tx.subHireItem.create({
      data: {
        subHireId: subHireOrphan.id,
        groupId: shGroupOrphan.id,
        description: "Last-minute item (seed)",
        quantity: 1,
        unitCost: 50,
        unitCharge: 120,
        sortOrder: 0,
      },
    });

    // ── CategorySlot backfill for the new groups ─────────────────────
    // The migration's backfill only ran on rows that existed at deploy time.
    // New groups created via the seed need their slot rows too — the
    // production server actions will eventually own this, but for now
    // create them inline so the seeded project queries cleanly.
    await tx.categorySlot.create({
      data: {
        projectCategoryId: catAudio.id,
        projectGroupId: groupMics.id,
        sortOrder: 0,
      },
    });
    await tx.categorySlot.create({
      data: {
        projectCategoryId: catAudio.id,
        subHireGroupId: shGroupSmoke.id,
        sortOrder: 1,
      },
    });
    await tx.categorySlot.create({
      data: {
        projectCategoryId: catLighting.id,
        projectGroupId: groupLighting.id,
        sortOrder: 0,
      },
    });
    // shGroupOrphan: no slot (uncategorised, NULL targetCategoryId)
  });

  console.log(`[seed] done — open /projects to see "${PROJECT_NAME}"`);
}

async function upsertModel(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  orgId: string,
  name: string,
  dailyRate: number,
  weeklyRate: number,
) {
  const existing = await tx.model.findFirst({
    where: { organizationId: orgId, name },
  });
  if (existing) return existing;
  return tx.model.create({
    data: {
      organizationId: orgId,
      name,
      dailyRate,
      weeklyRate,
    },
  });
}

main()
  .catch((e) => {
    console.error("[seed] failed", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

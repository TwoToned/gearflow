/**
 * Dev seed — supplier-order data for validating the Phase A read-rewiring of
 * `src/server/supplier-orders.ts` against Convex.
 *
 * Creates suppliers + orders (varied type/status, project-linked + createdBy) with
 * items (model/asset links + prices). Idempotent — keyed off the seed prefix.
 *
 *   npm run seed:supplier-orders   (after `npm run seed` so a project/models exist)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PFX = "SOSEED";
const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const d = (o: number) => new Date(now + o * day);

async function main() {
  console.log("[so-seed] starting");
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("[so-seed] no organization");
  const orgId = org.id;

  const project = await prisma.project.findFirst({ where: { organizationId: orgId, isTemplate: false }, orderBy: { createdAt: "asc" } });
  const models = await prisma.model.findMany({ where: { organizationId: orgId }, take: 2 });
  const asset = await prisma.asset.findFirst({ where: { organizationId: orgId } });
  const user = await prisma.user.findFirst();

  // ── suppliers ─────────────────────────────────────────────────────────────
  const supDefs = [
    { name: `${PFX} Acme Hire`, email: `acme.${PFX.toLowerCase()}@example.com` },
    { name: `${PFX} Bolt Repairs`, email: `bolt.${PFX.toLowerCase()}@example.com` },
  ];
  const suppliers: { id: string }[] = [];
  for (const s of supDefs) {
    const existing = await prisma.supplier.findFirst({ where: { organizationId: orgId, name: s.name } });
    const row = existing ?? (await prisma.supplier.create({ data: { organizationId: orgId, name: s.name, email: s.email, isActive: true } }));
    suppliers.push({ id: row.id });
  }

  // ── orders + items ────────────────────────────────────────────────────────
  const orderDefs = [
    { sfx: "001", supIdx: 0, type: "PURCHASE", status: "ORDERED", projectId: project?.id ?? null, createdById: user?.id ?? null, orderDate: d(-5), items: [{ description: "XLR cables 10x", quantity: 10, unitPrice: 25, modelIdx: 0, assetIdx: null }, { description: "Gaffer tape", quantity: 5, unitPrice: 12, modelIdx: null, assetIdx: null }] },
    { sfx: "002", supIdx: 1, type: "REPAIR", status: "DRAFT", projectId: null, createdById: null, orderDate: d(-2), items: [{ description: "Amp repair", quantity: 1, unitPrice: 350, modelIdx: 1, assetIdx: 0 }] },
    { sfx: "003", supIdx: 0, type: "SUBHIRE", status: "RECEIVED", projectId: project?.id ?? null, createdById: user?.id ?? null, orderDate: d(-10), items: [] },
  ];

  for (const o of orderDefs) {
    const orderNumber = `${PFX}-${o.sfx}`;
    const existing = await prisma.supplierOrder.findFirst({ where: { organizationId: orgId, orderNumber } });
    if (existing) continue;
    await prisma.supplierOrder.create({
      data: {
        organizationId: orgId, supplierId: suppliers[o.supIdx].id, orderNumber,
        type: o.type as never, status: o.status as never, orderDate: o.orderDate,
        projectId: o.projectId, createdById: o.createdById,
        items: {
          create: o.items.map((it, i) => ({
            description: it.description, quantity: it.quantity, unitPrice: it.unitPrice,
            lineTotal: it.unitPrice * it.quantity, sortOrder: i,
            modelId: it.modelIdx != null && models[it.modelIdx] ? models[it.modelIdx].id : null,
            assetId: it.assetIdx != null && asset ? asset.id : null,
          })),
        },
      },
    });
  }

  const counts = {
    suppliers: await prisma.supplier.count({ where: { organizationId: orgId } }),
    orders: await prisma.supplierOrder.count({ where: { organizationId: orgId } }),
    items: await prisma.supplierOrderItem.count(),
  };
  console.log("[so-seed] done:", JSON.stringify(counts));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

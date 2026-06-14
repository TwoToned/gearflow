/**
 * One-time (re-runnable) backfill: copy the sub-hire + supplier-order families —
 * sub_hire, sub_hire_item, sub_hire_group, supplier_order, supplier_order_item —
 * from Prisma into Convex.
 *
 * Central-graph step 5 (Phase 3), dual-write INFRA-ONLY. Idempotent — skips rows
 * already present (matched by cuid `id`). Maps Date -> ms, Decimal -> number,
 * null -> absent. sub_hire_media stays Prisma-only. See src/lib/sub-hire-mirror.ts
 * and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-sub-hires.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const subHires = await prisma.subHire.findMany();
  for (const r of subHires) {
    { const __res = await convex.mutation(api.subHires.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.subHires.createIfMissing>); if (__res.created) created++; else skipped++; }
  }
  const subHireItems = await prisma.subHireItem.findMany();
  for (const r of subHireItems) {
    { const __res = await convex.mutation(api.subHireItems.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.subHireItems.createIfMissing>); if (__res.created) created++; else skipped++; }
  }
  const subHireGroups = await prisma.subHireGroup.findMany();
  for (const r of subHireGroups) {
    { const __res = await convex.mutation(api.subHireGroups.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.subHireGroups.createIfMissing>); if (__res.created) created++; else skipped++; }
  }
  const supplierOrders = await prisma.supplierOrder.findMany();
  for (const r of supplierOrders) {
    { const __res = await convex.mutation(api.supplierOrders.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.supplierOrders.createIfMissing>); if (__res.created) created++; else skipped++; }
  }
  const supplierOrderItems = await prisma.supplierOrderItem.findMany();
  for (const r of supplierOrderItems) {
    { const __res = await convex.mutation(api.supplierOrderItems.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.supplierOrderItems.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  console.log(
    `Sub-hire/supplier-order backfill complete: ${created} created, ${skipped} already present ` +
    `(${subHires.length} sub-hires, ${subHireItems.length} items, ${subHireGroups.length} groups, ` +
    `${supplierOrders.length} orders, ${supplierOrderItems.length} order items).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

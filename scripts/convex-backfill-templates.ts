/**
 * One-time (re-runnable) backfill: copy document_template + service_template from
 * Prisma into Convex.
 *
 * Templates domain (Phase 3), dual-write. Idempotent — skips rows already present
 * in Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal -> number, null
 * -> absent. Also the heal path for the dual-write. Both are infra-only (no Phase 4
 * reactive UI yet) — see src/lib/template-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-templates.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = getConvexClient();
  let created = 0;
  let skipped = 0;

  const docs = await prisma.documentTemplate.findMany();
  for (const d of docs) {
    if (await convex.query(api.documentTemplates.getById, { id: d.id })) { skipped++; continue; }
    await convex.mutation(api.documentTemplates.create, toConvexDoc(d) as FunctionArgs<typeof api.documentTemplates.create>);
    created++;
  }

  const svcs = await prisma.serviceTemplate.findMany();
  for (const s of svcs) {
    if (await convex.query(api.serviceTemplates.getById, { id: s.id })) { skipped++; continue; }
    await convex.mutation(api.serviceTemplates.create, toConvexDoc(s) as FunctionArgs<typeof api.serviceTemplates.create>);
    created++;
  }

  console.log(
    `Templates backfill complete: ${created} created, ${skipped} already present ` +
    `(${docs.length} document templates, ${svcs.length} service templates).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

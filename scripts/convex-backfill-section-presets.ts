/**
 * One-time (re-runnable) backfill: copy the SectionPreset table from Prisma into Convex.
 *
 * Section-presets domain (Phase 3). Idempotent — skips presets already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent; `sections`
 * is already a JSON string in Prisma so it passes straight through to Convex
 * `v.string()`. Also the heal path for the dual-write. Run after the Convex stack
 * is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-section-presets.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type SectionPresetCreateArgs = FunctionArgs<typeof api.sectionPresets.create>;

async function main() {
  const convex = (await getConvexClient());
  const presets = await prisma.sectionPreset.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${presets.length} section presets in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const p of presets) {
    const __res = await convex.mutation(api.sectionPresets.createIfMissing, toConvexDoc(p) as SectionPresetCreateArgs);
    if (__res.created) created++; else skipped++;
    console.log(`  + ${p.name} (${p.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { defineSchema } from "convex/server";

/**
 * Convex schema for GearFlow.
 *
 * EMPTY in Phase 0 — tables are added domain-by-domain in Phase 1, converting
 * each of the 95 Prisma models (prisma/schema.prisma) into a defineTable().
 * See docs/designs/convex-hybrid-migration.md (Phase 1) and convex/README.md
 * for the mapping rules and conventions.
 */
export default defineSchema({
  // Phase 1: projects, assets, kits, line-items, warehouse, ... (one domain per PR)
});

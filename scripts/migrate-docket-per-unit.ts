/**
 * One-time data migration: turn on `showPerUnitCheckboxes` for every
 * saved delivery-docket template that has it explicitly false in its
 * settings JSON. The system default was flipped in code (v0.7.x), but
 * organisations that customised their docket template before that
 * change saved `false` and still get the old single-row rendering.
 *
 * Idempotent — re-running is a no-op. Reversible — operators can
 * toggle the flag off via the document template editor.
 *
 * Usage:
 *   tsx --env-file=.env scripts/migrate-docket-per-unit.ts            # dry-run
 *   tsx --env-file=.env scripts/migrate-docket-per-unit.ts --apply    # writes
 */

import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

async function main() {
  const templates = await prisma.documentTemplate.findMany({
    where: { type: "delivery-docket", settings: { not: null } },
    select: { id: true, name: true, organizationId: true, settings: true },
  });

  let touched = 0;
  for (const t of templates) {
    if (!t.settings) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t.settings);
    } catch {
      console.log(`SKIP ${t.id} (${t.name}) — settings not valid JSON`);
      continue;
    }
    const s = parsed as Record<string, unknown>;
    const table = (s.table as Record<string, unknown> | undefined) ?? {};
    if (table.showPerUnitCheckboxes === false) {
      table.showPerUnitCheckboxes = true;
      s.table = table;
      console.log(
        `${apply ? "FIX " : "PLAN"} ${t.id} (${t.name}) — flip showPerUnitCheckboxes false → true`,
      );
      if (apply) {
        await prisma.documentTemplate.update({
          where: { id: t.id },
          data: { settings: JSON.stringify(s) },
        });
      }
      touched += 1;
    } else {
      console.log(`OK   ${t.id} (${t.name}) — already on or undefined`);
    }
  }
  console.log();
  console.log(`Summary: ${touched} template(s) ${apply ? "updated" : "would be updated"}`);
}
main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

/**
 * One-time data migration: turn on `showPerUnitCheckboxes` for every saved
 * delivery-docket template so multi-quantity lines render one row per unit
 * (Unit 1 — TTP00042, …) instead of collapsing to "tag, tag +N".
 *
 * The system defaults were flipped in code (v0.7.x):
 *   - legacy  getDefaultSettings("delivery-docket")  → already true
 *   - section getDefaultSections("delivery-docket")  → fixed in this release
 * Organisations that customised their docket template before those changes
 * saved `false` and still get the old single-row rendering.
 *
 * Two storage shapes exist on DocumentTemplate and BOTH are handled here:
 *   1. SECTION-based (modern editor, the active render path) — the flag lives
 *      in `sections[type==="table"].settings.showPerUnitCheckboxes`. This is
 *      the case the original migration MISSED: render uses `sections` first
 *      (generate-pdf loadTemplate), so flipping only the legacy blob was a
 *      no-op for these templates.
 *   2. LEGACY settings blob — the flag lives in `settings.table.showPerUnitCheckboxes`.
 *
 * Idempotent — re-running is a no-op. Reversible — operators can toggle the
 * flag off again via the document template editor.
 *
 * Usage:
 *   tsx --env-file=.env scripts/migrate-docket-per-unit.ts            # dry-run
 *   tsx --env-file=.env scripts/migrate-docket-per-unit.ts --apply    # writes
 *   tsx --env-file=.env scripts/migrate-docket-per-unit.ts --org <id> # scope to one org
 */

import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");
const orgArgIdx = process.argv.indexOf("--org");
const orgId = orgArgIdx !== -1 ? process.argv[orgArgIdx + 1] : undefined;

/**
 * Flip showPerUnitCheckboxes → true inside a section-based template's JSON.
 * Returns the new JSON string if a change was needed, else null (no-op).
 */
function fixSections(sectionsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sectionsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  let changed = false;
  for (const section of parsed as Array<Record<string, unknown>>) {
    if (section?.type !== "table") continue;
    const settings = (section.settings as Record<string, unknown> | undefined) ?? {};
    if (settings.showPerUnitCheckboxes !== true) {
      settings.showPerUnitCheckboxes = true;
      section.settings = settings;
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : null;
}

/**
 * Flip showPerUnitCheckboxes → true inside a legacy settings blob.
 * Returns the new JSON string if a change was needed, else null (no-op).
 */
function fixLegacySettings(settingsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    return null;
  }
  const s = parsed as Record<string, unknown>;
  const table = (s.table as Record<string, unknown> | undefined) ?? {};
  if (table.showPerUnitCheckboxes === true) return null;
  table.showPerUnitCheckboxes = true;
  s.table = table;
  return JSON.stringify(s);
}

async function main() {
  console.log(`Mode: ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (orgId) console.log(`Org:  ${orgId}`);
  console.log();

  const templates = await prisma.documentTemplate.findMany({
    where: {
      type: "delivery-docket",
      ...(orgId ? { organizationId: orgId } : {}),
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      isDraft: true,
      isDefault: true,
      sections: true,
      settings: true,
    },
  });

  let touched = 0;
  for (const t of templates) {
    const flags: string[] = [];
    const data: { sections?: string; settings?: string } = {};

    if (t.sections) {
      const next = fixSections(t.sections);
      if (next) {
        data.sections = next;
        flags.push("sections");
      }
    }
    if (t.settings) {
      const next = fixLegacySettings(t.settings);
      if (next) {
        data.settings = next;
        flags.push("settings");
      }
    }

    const tag = `${t.id} (${t.name})${t.isDefault ? " [default]" : ""}${t.isDraft ? " [draft]" : ""}`;
    if (flags.length === 0) {
      console.log(`OK   ${tag} — already on`);
      continue;
    }
    console.log(`${apply ? "FIX " : "PLAN"} ${tag} — flip showPerUnitCheckboxes → true in: ${flags.join(", ")}`);
    if (apply) {
      await prisma.documentTemplate.update({ where: { id: t.id }, data });
    }
    touched += 1;
  }

  console.log();
  console.log(`Summary: ${touched} template(s) ${apply ? "updated" : "would be updated"} (${templates.length} scanned)`);
  if (!apply && touched > 0) console.log("Re-run with --apply to execute.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

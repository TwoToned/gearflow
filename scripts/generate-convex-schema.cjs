#!/usr/bin/env node
/* Deterministic Prisma schema -> Convex schema generator for RVLT Flow Phase 1.
 * Parsing lives in scripts/lib/prisma-to-convex.cjs (shared with the CRUD gen).
 * Emits convex/lib/validators.ts (enums) and convex/schema.ts (tables).
 * See FEATUREDOCS/54. Run: node scripts/generate-convex-schema.cjs . */
const fs = require("fs");
const path = require("path");
const { parse } = require("./lib/prisma-to-convex.cjs");

const ROOT = process.argv[2] || ".";
const { enums, models } = parse(ROOT);

// ── Emit validators.ts ──────────────────────────────────────────────────────
let vOut = `import { v } from "convex/values";\n\n`;
vOut += `/**\n * Convex validators for the ${Object.keys(enums).length} Prisma enums.\n *\n * Generated from prisma/schema.prisma (Phase 1 of the Convex migration).\n * Reused as field validators in convex/schema.ts and as mutation arg validators\n * in the per-domain function files (Phase 2). Keep in sync with the Prisma enums.\n */\n\n`;
for (const name of Object.keys(enums)) {
  const lits = enums[name].map(x => `v.literal("${x}")`);
  if (lits.length === 1) vOut += `export const ${name} = ${lits[0]};\n`;
  else vOut += `export const ${name} = v.union(\n${lits.map(l => "  " + l).join(",\n")},\n);\n`;
}

// ── Emit schema.ts ──────────────────────────────────────────────────────────
let sOut = `import { defineSchema, defineTable } from "convex/server";\nimport { v } from "convex/values";\nimport * as enums from "./lib/validators";\n\n`;
sOut += `/**\n * RVLT Flow Convex schema — generated from prisma/schema.prisma (Phase 1).\n *\n * ${models.length} tables mirroring the Prisma models. Conventions:\n *  - The Prisma primary cuid \`@id\` is PRESERVED as a stored \`id: v.string()\`\n *    field with a \`by_cuid\` index — NOT dropped in favour of Convex's \`_id\`. The\n *    app holds cuids everywhere (URLs, FK strings, server-action args), so every\n *    lookup keys off \`id\`; Convex's own \`_id\` stays internal/unused.\n *  - Foreign keys are stored as \`v.string()\` (the source cuid) during the hybrid\n *    migration — NOT v.id() — so Convex docs interoperate with the existing\n *    Prisma id space and with auth-owned entities (user/organization) that stay\n *    in Better Auth. FK fields drive indexes. (Native v.id() is a post-data-\n *    migration optimization.) See FEATUREDOCS/54.\n *  - DateTime/Decimal -> v.number(); Json -> v.any(); enums -> ./lib/validators.\n *  - Optional iff the Prisma field is nullable, has a default, is a list, or is\n *    @updatedAt (so inserts/migration backfill aren't forced to set them).\n *  - createdAt/updatedAt are kept (optional) to preserve migrated timestamps;\n *    Convex also exposes _creationTime automatically.\n *  - @unique is NOT enforced by Convex indexes — uniqueness is enforced in the\n *    mutations that own each table. The by_<field> index still exists for lookup.\n *\n * Regenerate with: node scripts/generate-convex-schema.cjs . — if the Prisma\n * schema changes. Review by hand afterwards (generated scaffolding, not final).\n */\nexport default defineSchema({\n`;
for (const mdl of models) {
  sOut += `  // ${mdl.name}\n`;
  sOut += `  ${mdl.key}: defineTable({\n`;
  for (const f of mdl.fields) {
    const val = f.optional ? `v.optional(${f.validator})` : f.validator;
    sOut += `    ${f.name}: ${val},\n`;
  }
  sOut += `  })`;
  for (const ix of mdl.indexes) {
    sOut += `\n    .index("${ix.name}", [${ix.fields.map(x => `"${x}"`).join(", ")}])`;
  }
  sOut += `,\n\n`;
}
sOut += `});\n`;

fs.mkdirSync(path.join(ROOT, "convex/lib"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "convex/lib/validators.ts"), vOut);
fs.writeFileSync(path.join(ROOT, "convex/schema.ts"), sOut);

console.log(`enums: ${Object.keys(enums).length}`);
console.log(`models: ${models.length}`);
console.log(`total fields: ${models.reduce((a, m) => a + m.fields.length, 0)}`);
console.log(`total indexes: ${models.reduce((a, m) => a + m.indexes.length, 0)}`);
const tn = models.map(m => m.key);
const dupes = tn.filter((x, i) => tn.indexOf(x) !== i);
if (dupes.length) console.log("DUPLICATE TABLE KEYS:", dupes);

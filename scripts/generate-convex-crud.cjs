#!/usr/bin/env node
/* Deterministic thin-CRUD generator for GearFlow Phase 2.
 *
 * For each app-data table, emits convex/<tableKey>.ts with list / getById /
 * create / update / remove (the doc's standard 5). Stubs are UNAUTHED — the
 * Next.js server actions that call them keep all permission/validation/audit
 * logic. Lookups key off the preserved cuid (`id`) via the by_cuid index;
 * org-scoped tables list by_organizationId, others by their parent FK.
 * Parsing is shared with the schema gen (scripts/lib/prisma-to-convex.cjs).
 * See FEATUREDOCS/54. Run: node scripts/generate-convex-crud.cjs . */
const fs = require("fs");
const path = require("path");
const { parse } = require("./lib/prisma-to-convex.cjs");

const ROOT = process.argv[2] || ".";
const { models } = parse(ROOT);

// Tables owned by Better Auth / Prisma forever — no Convex CRUD. (Auth + org
// membership + permissions stay in Better Auth; activityLog stays in Prisma per
// the design doc's Phase 6.)
const EXCLUDE = new Set([
  "users", "sessions", "accounts", "verifications", "organizations",
  "members", "invitations", "customRoles", "ssoProviders", "pendingSSOApprovals",
  "twoFactors", "backupCodes", "passkeys", "activityLogs",
]);

function fieldExpr(f) {
  return f.optional ? `v.optional(${f.validator})` : f.validator;
}

let written = 0;
const generated = [];
for (const mdl of models) {
  if (EXCLUDE.has(mdl.key)) continue;
  const key = mdl.key;
  const usesEnums = mdl.fields.some(f => f.validator.startsWith("enums."));
  // the cuid id is usually v.string(), but a couple of tables use an Int @id
  // (e.g. discordOutbox's autoincrement cursor) — key lookups off the real type
  const idField = mdl.fields.find(f => f.name === mdl.idField);
  const idValidator = idField ? idField.validator : "v.string()";

  // create args = full table shape (incl. cuid id); patch = every field but id, optional
  const createArgs = mdl.fields.map(f => `    ${f.name}: ${fieldExpr(f)},`).join("\n");
  const patchArgs = mdl.fields
    .filter(f => f.name !== mdl.idField)
    .map(f => `      ${f.name}: v.optional(${f.validator}),`)
    .join("\n");

  // list scoping: org -> by_organizationId; else first FK -> by_<fk>; else all
  let listArgs, listBody;
  if (mdl.orgScoped) {
    listArgs = `{ orgId: v.string() }`;
    listBody = `ctx.db\n      .query("${key}")\n      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))\n      .collect()`;
  } else if (mdl.firstFk) {
    const fk = mdl.firstFk;
    listArgs = `{ ${fk}: v.string() }`;
    listBody = `ctx.db\n      .query("${key}")\n      .withIndex("by_${fk}", (q) => q.eq("${fk}", ${fk}))\n      .collect()`;
  } else {
    listArgs = `{}`;
    listBody = `ctx.db.query("${key}").collect()`;
  }
  const listDestructure = mdl.orgScoped
    ? `{ orgId }`
    : mdl.firstFk
    ? `{ ${mdl.firstFk} }`
    : `_args`;

  const lookup = `ctx.db.query("${key}").withIndex("by_cuid", (q) => q.eq("id", id)).unique()`;

  let out = `import { v } from "convex/values";\n`;
  out += `import { query, mutation } from "./_generated/server";\n`;
  if (usesEnums) out += `import * as enums from "./lib/validators";\n`;
  out += `\n`;
  out += `/**\n * Thin CRUD for ${mdl.name} (Convex table "${key}"). GENERATED — Phase 2.\n *\n * UNAUTHED by design: the Next.js server action that calls each function has\n * already authenticated the user, checked requirePermission, validated input,\n * and will write the activity log. Do not add auth here. Lookups use the cuid\n * (\`id\`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.\n */\n\n`;

  out += `export const list = query({\n  args: ${listArgs},\n  handler: async (ctx, ${listDestructure}) =>\n    await ${listBody},\n});\n\n`;

  out += `export const getById = query({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) =>\n    await ${lookup},\n});\n\n`;

  out += `export const create = mutation({\n  args: {\n${createArgs}\n  },\n  handler: async (ctx, args) => await ctx.db.insert("${key}", args),\n});\n\n`;

  out += `export const update = mutation({\n  args: {\n    id: ${idValidator},\n    patch: v.object({\n${patchArgs}\n    }),\n  },\n  handler: async (ctx, { id, patch }) => {\n    const doc = await ${lookup};\n    if (!doc) throw new Error("${key} not found: " + id);\n    await ctx.db.patch(doc._id, patch);\n    return doc._id;\n  },\n});\n\n`;

  out += `export const remove = mutation({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) => {\n    const doc = await ${lookup};\n    if (!doc) throw new Error("${key} not found: " + id);\n    await ctx.db.delete(doc._id);\n  },\n});\n`;

  fs.writeFileSync(path.join(ROOT, "convex", `${key}.ts`), out);
  written++;
  generated.push(key);
}

console.log(`generated CRUD modules: ${written}`);
console.log(`excluded (stay in Prisma/Better Auth): ${[...EXCLUDE].join(", ")}`);
console.log(`functions: ${written * 5}`);

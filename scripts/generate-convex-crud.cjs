#!/usr/bin/env node
/* Deterministic thin-CRUD generator for GearFlow Phase 2 (auth-hardened in Phase 5).
 *
 * For each app-data table, emits convex/<tableKey>.ts with list / getById /
 * create / update / remove (the doc's standard 5). Lookups key off the preserved
 * cuid (`id`) via the by_cuid index; org-scoped tables list by_organizationId,
 * others by their parent FK.
 *
 * Phase 5 auth (convex/lib/auth.ts, docs/designs/convex-phase5-auth-bridge.md):
 *   • every MUTATION (create/update/remove) → requireService (the trusted backend
 *     service token; browser writes rejected, RBAC stays in Prisma server actions).
 *   • list/getById are **service-only by default** (requireService). A table opens
 *     to org-scoped user reads (requireOrgRead / requireOrgReadDoc) ONLY if it is
 *     org-scoped AND on the explicit BROWSER_READABLE allowlist below.
 *
 * Why an allowlist, not "has organizationId": several org-scoped tables carry
 * plaintext secrets in their columns (warehouse/auditor access tokens, WooCommerce
 * webhook secret, Discord signing secret). "org-scoped ⇒ user-readable" would hand
 * those secrets to any authenticated org member (incl. a viewer) via the public
 * Convex read, bypassing Prisma RBAC. Default-deny: a table only becomes
 * browser-readable when its UI actually goes reactive and it's added here. The
 * allowlist is exactly the tables with a src/hooks/use-*.ts subscriber.
 *
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
  // Better Auth jwt() plugin key store (Phase 5 auth bridge) — auth-owned, never
  // written from Convex. Present in the Convex schema for completeness like the
  // other auth tables, but gets no CRUD.
  "jwkses",
]);

// Tables the BROWSER may read with a user token (org-scoped). Everything else is
// service-only. This is exactly the set with a reactive src/hooks/use-*.ts
// subscriber; add a table here only when its UI goes reactive AND its columns
// hold no secrets. Default-deny — keeps secret-bearing org tables (access tokens,
// webhook/signing secrets) off the browser-readable path. See the header note.
const BROWSER_READABLE = new Set([
  "clients", "suppliers", "locations", "models", "categories", "checkItems",
  "testProfiles", "customFieldDefinitions", "crewMembers", "crewRoles",
  "crewSkills", "kits", "assets", "bulkAssets",
  // Check-item assignment join tables (model/kit "Checks" tabs go reactive). No
  // secrets — just modelId/kitId + checkItemId + sortOrder.
  "modelCheckItems", "kitCheckItems",
  // Phase 4 reactive cutover (2026-06): project graph + crew scheduling + the
  // damage/maintenance/back-office surfaces all went cross-tab reactive. None
  // hold secrets. See FEATUREDOCS/54 "Phase 4 reactive cutover".
  "projects", "projectCategories", "projectGroups", "projectManagers",
  "projectServices", "projectTasks", "projectLineItems", "subHires",
  "crewAssignments", "crewTimeEntries", "crewAvailabilities",
  "damageEvents", "maintenanceRecords",
  "supplierOrders", "warehouseCloses", "savedReports", "savedTableViews",
]);

// Tables whose rows feed a denormalised dashboard counter (convex/dashboardCounters.ts,
// §3.6). Their mutating funcs keep the counter row in sync IN-TRANSACTION via
// bumpCountersForTable (convex/lib/counters.ts) — a per-write delta so the native
// dashboard never scans the whole-org registry on view. `reconcile` stays as the
// drift backstop. The dispatch is generic (keyed by table); the contribution
// predicates live in counters.ts and must match computeCounters.
const COUNTED = new Set(["assets", "bulkAssets", "projects", "crewMembers", "crewAssignments"]);

// Browser-readable tables that also get a per-project list (they carry a
// projectId and the UI subscribes by project, not whole-org). Emits
// `listByProject({ projectId, orgId })` guarded by requireOrgRead.
const LIST_BY_PROJECT = new Set([
  "projectCategories", "projectGroups", "projectManagers", "projectServices",
  "projectTasks", "projectLineItems", "subHires", "crewAssignments",
]);

// Service-only tables that get a PARENT-scoped list (security review P1-4): the
// per-parent media reconcile must query only the parent's rows, never the whole
// org. Maps table -> parent FK field (each already has a by_<fk> index). Emits
// `listByParent({ parentId })` guarded by requireService (media isn't browser-
// readable). See src/lib/media-mirror.ts.
const LIST_BY_PARENT = {
  modelMedia: "modelId", assetMedia: "assetId", kitMedia: "kitId",
  projectMedia: "projectId", clientMedia: "clientId", locationMedia: "locationId",
  subHireMedia: "subHireId",
};

// Per-table fields stripped from BROWSER reads (the user token never sees them;
// the trusted service token still does). For browser-readable tables that hold a
// sensitive-but-internal column the reactive UI doesn't need. Default: nothing
// redacted. `crewMembers.icalToken` is a per-member calendar-feed secret —
// browser members get the rest of the row but not the token (the crew detail
// page reads the token via a Prisma-backed server action, not this read).
const REDACTED_FIELDS = {
  crewMembers: ["icalToken"],
};

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

  // Auth guards (Phase 5). A table's reads open to org-scoped USER tokens only
  // when it's org-scoped AND explicitly browser-readable; otherwise reads (like
  // all writes) are service-only. Import only the helpers the file references.
  const browserReadable = mdl.orgScoped && BROWSER_READABLE.has(key);
  const redactedFields = (browserReadable && REDACTED_FIELDS[key]) || null;
  const redactArg = redactedFields
    ? `[${redactedFields.map((f) => `"${f}"`).join(", ")}]`
    : null;
  const authImports = browserReadable
    ? `import { requireOrgRead, requireOrgReadDoc, requireService${redactedFields ? ", getAuthContext, redactFields" : ""} } from "./lib/auth";\n`
    : `import { requireService } from "./lib/auth";\n`;

  // Counter-maintained tables (§3.6) import the in-transaction dispatch helper.
  const counted = COUNTED.has(key);
  const bump = (before, after) => (counted ? `\n    await bumpCountersForTable(ctx, "${key}", ${before}, ${after});` : "");

  let out = `import { v } from "convex/values";\n`;
  out += `import { query, mutation } from "./_generated/server";\n`;
  out += authImports;
  if (counted) out += `import { bumpCountersForTable } from "./lib/counters";\n`;
  if (usesEnums) out += `import * as enums from "./lib/validators";\n`;
  out += `\n`;
  out += `/**\n * Thin CRUD for ${mdl.name} (Convex table "${key}"). GENERATED — Phase 2/5.\n *\n * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend\n * SERVICE token (browser writes rejected — RBAC stays in the Next.js server\n * actions, which still own permission/validation/audit). ${browserReadable ? "Org-scoped reads\n * accept the service token OR a user token scoped to the same org." : "Reads are\n * service-only (not on the browser-readable allowlist)."} Lookups use the\n * cuid (\`id\`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.\n */\n\n`;

  if (browserReadable && redactArg) {
    // Browser-readable WITH field redaction: the user token gets the row minus
    // the redacted column(s); the trusted service token gets everything.
    out += `export const list = query({\n  args: ${listArgs},\n  handler: async (ctx, ${listDestructure}) => {\n    await requireOrgRead(ctx, orgId);\n    const docs = await ${listBody};\n    const auth = await getAuthContext(ctx);\n    return auth?.kind === "service" ? docs : docs.map((d) => redactFields(d, ${redactArg}));\n  },\n});\n\n`;
    out += `export const getById = query({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) => {\n    const doc = await ${lookup};\n    await requireOrgReadDoc(ctx, doc);\n    if (!doc) return doc;\n    const auth = await getAuthContext(ctx);\n    return auth?.kind === "service" ? doc : redactFields(doc, ${redactArg});\n  },\n});\n\n`;
  } else if (browserReadable) {
    out += `export const list = query({\n  args: ${listArgs},\n  handler: async (ctx, ${listDestructure}) => {\n    await requireOrgRead(ctx, orgId);\n    return await ${listBody};\n  },\n});\n\n`;
    out += `export const getById = query({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) => {\n    const doc = await ${lookup};\n    await requireOrgReadDoc(ctx, doc);\n    return doc;\n  },\n});\n\n`;
  } else {
    out += `export const list = query({\n  args: ${listArgs},\n  handler: async (ctx, ${listDestructure}) => {\n    await requireService(ctx);\n    return await ${listBody};\n  },\n});\n\n`;
    out += `export const getById = query({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) => {\n    await requireService(ctx);\n    return await ${lookup};\n  },\n});\n\n`;
  }

  // Per-project reactive read (browser-readable tables that carry a projectId).
  if (browserReadable && LIST_BY_PROJECT.has(key)) {
    out += `export const listByProject = query({\n  args: { projectId: v.string(), orgId: v.string() },\n  handler: async (ctx, { projectId, orgId }) => {\n    await requireOrgRead(ctx, orgId);\n    return await ctx.db\n      .query("${key}")\n      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))\n      .collect();\n  },\n});\n\n`;
  }

  // Parent-scoped service read (media reconcile — P1-4).
  if (LIST_BY_PARENT[key]) {
    const pfk = LIST_BY_PARENT[key];
    out += `export const listByParent = query({\n  args: { parentId: v.string() },\n  handler: async (ctx, { parentId }) => {\n    await requireService(ctx);\n    return await ctx.db\n      .query("${key}")\n      .withIndex("by_${pfk}", (q) => q.eq("${pfk}", parentId))\n      .collect();\n  },\n});\n\n`;
  }

  out += counted
    ? `export const create = mutation({\n  args: {\n${createArgs}\n  },\n  handler: async (ctx, args) => {\n    await requireService(ctx);\n    const _id = await ctx.db.insert("${key}", args);${bump("null", "args")}\n    return _id;\n  },\n});\n\n`
    : `export const create = mutation({\n  args: {\n${createArgs}\n  },\n  handler: async (ctx, args) => {\n    await requireService(ctx);\n    return await ctx.db.insert("${key}", args);\n  },\n});\n\n`;

  // Atomic, idempotent create for backfills (security review P0-2): the check +
  // insert happen inside ONE serializable Convex mutation, so a concurrent
  // dual-write can't race a query-then-create into duplicate \`id\` rows.
  out += `export const createIfMissing = mutation({\n  args: {\n${createArgs}\n  },\n  handler: async (ctx, args) => {\n    await requireService(ctx);\n    const existing = await ctx.db.query("${key}").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();\n    if (existing) return { _id: existing._id, created: false };\n    const _id = await ctx.db.insert("${key}", args);${bump("null", "args")}\n    return { _id, created: true };\n  },\n});\n\n`;

  // organizationId is set on create and IMMUTABLE thereafter (security review
  // P1-1): strip it from the patch so no write can move a row across tenants,
  // even if a future server bug spreads user input into the patch.
  const patchExpr = mdl.orgScoped
    ? `const safePatch = { ...patch };\n    delete safePatch.organizationId;\n    await ctx.db.patch(doc._id, safePatch);${bump("doc", "{ ...doc, ...safePatch }")}`
    : `await ctx.db.patch(doc._id, patch);${bump("doc", "{ ...doc, ...patch }")}`;
  out += `export const update = mutation({\n  args: {\n    id: ${idValidator},\n    patch: v.object({\n${patchArgs}\n    }),\n  },\n  handler: async (ctx, { id, patch }) => {\n    await requireService(ctx);\n    const doc = await ${lookup};\n    if (!doc) throw new Error("${key} not found: " + id);\n    ${patchExpr}\n    return doc._id;\n  },\n});\n\n`;

  out += `export const remove = mutation({\n  args: { id: ${idValidator} },\n  handler: async (ctx, { id }) => {\n    await requireService(ctx);\n    const doc = await ${lookup};\n    if (!doc) throw new Error("${key} not found: " + id);\n    await ctx.db.delete(doc._id);${bump("doc", "null")}\n  },\n});\n`;

  fs.writeFileSync(path.join(ROOT, "convex", `${key}.ts`), out);
  written++;
  generated.push(key);
}

console.log(`generated CRUD modules: ${written}`);
console.log(`excluded (stay in Prisma/Better Auth): ${[...EXCLUDE].join(", ")}`);
console.log(`functions: ${written * 5}`);

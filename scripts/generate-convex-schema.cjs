#!/usr/bin/env node
/* Deterministic Prisma schema -> Convex schema generator for GearFlow Phase 1.
 * Reads prisma/schema.prisma, emits convex/lib/validators.ts (enums) and
 * convex/schema.ts (tables). FK scalars stay v.string() (cuid interop) and only
 * drive index creation. See FEATUREDOCS/54. */
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2];
const schemaPath = path.join(ROOT, "prisma/schema.prisma");
const raw = fs.readFileSync(schemaPath, "utf8");
const lines = raw.split("\n");

// ── Pass 1: collect enum + model names ──────────────────────────────────────
const enumNames = new Set();
const modelNames = new Set();
for (const l of lines) {
  let m = l.match(/^enum\s+(\w+)\s*\{/);
  if (m) enumNames.add(m[1]);
  m = l.match(/^model\s+(\w+)\s*\{/);
  if (m) modelNames.add(m[1]);
}

// ── Table naming: model (PascalCase) -> convex key (camelCase plural) ────────
const UNCOUNTABLE = new Set(["media", "settings", "metadata"]);
const IRREGULAR = { child: "children", person: "people" };
function pluralize(word) {
  const lower = word.toLowerCase();
  for (const [sing, plur] of Object.entries(IRREGULAR)) {
    if (lower.endsWith(sing)) {
      const removed = word.slice(word.length - sing.length);
      const cap = removed[0] === removed[0].toUpperCase();
      const rep = cap ? plur.charAt(0).toUpperCase() + plur.slice(1) : plur;
      return word.slice(0, word.length - sing.length) + rep;
    }
  }
  for (const u of UNCOUNTABLE) if (lower.endsWith(u)) return word;
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
}
function tableKey(model) {
  const camel = model.charAt(0).toLowerCase() + model.slice(1);
  return pluralize(camel);
}
const tableNameOf = {};
for (const m of modelNames) tableNameOf[m] = tableKey(m);

// ── Pass 2: parse enums ─────────────────────────────────────────────────────
const enums = {}; // name -> [values]
{
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^enum\s+(\w+)\s*\{/);
    if (m) { cur = m[1]; enums[cur] = []; continue; }
    if (cur) {
      if (l.match(/^\}/)) { cur = null; continue; }
      const t = l.trim();
      if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
      const val = t.split(/\s+/)[0];
      if (/^[A-Za-z_]\w*$/.test(val)) enums[cur].push(val);
    }
  }
}

// ── Pass 2: parse models ────────────────────────────────────────────────────
const SCALAR = {
  String: "v.string()", Boolean: "v.boolean()", Int: "v.number()",
  Float: "v.number()", Decimal: "v.number()", DateTime: "v.number()",
  Json: "v.any()", BigInt: "v.int64()", Bytes: "v.bytes()",
};
function mapType(base) {
  if (SCALAR[base]) return SCALAR[base];
  if (enumNames.has(base)) return `enums.${base}`;
  // object relation type — should never be emitted as a stored field
  throw new Error("unexpected base type: " + base);
}

const models = []; // {name, key, fields:[{name,validator,optional}], indexes:[{name,fields}]}
{
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^model\s+(\w+)\s*\{/);
    if (m) { cur = { name: m[1], key: tableNameOf[m[1]], fields: [], fkFields: [], uniques: [], compounds: [] }; continue; }
    if (cur) {
      if (l.match(/^\}/)) { models.push(cur); cur = null; continue; }
      const t = l.trim();
      if (!t || t.startsWith("//")) continue;

      // block-level attributes
      let bm;
      if ((bm = t.match(/^@@unique\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if ((bm = t.match(/^@@index\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if ((bm = t.match(/^@@id\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if (t.startsWith("@@")) continue; // @@map etc.

      // field line: name Type attrs...
      const fm = t.match(/^(\w+)\s+([\w.]+)(\??)(\[\])?\s*(.*)$/);
      if (!fm) continue;
      const fname = fm[1];
      const base = fm[2];
      const optMark = fm[3] === "?";
      const isList = !!fm[4];
      const attrs = fm[5] || "";

      const isId = /@id\b/.test(attrs);
      const isUnique = /@unique\b/.test(attrs);
      const hasDefault = /@default\(/.test(attrs);
      const isUpdatedAt = /@updatedAt\b/.test(attrs);
      const isObject = modelNames.has(base);

      // object relation field: not stored. Record FK scalar(s) from @relation(fields:[...])
      if (isObject) {
        const relm = attrs.match(/fields:\s*\[([^\]]+)\]/);
        if (relm) relm[1].split(",").forEach(s => cur.fkFields.push(s.trim()));
        continue;
      }
      // primary id -> Convex _id; skip
      if (isId) continue;

      let validator = mapType(base);
      if (isList) validator = `v.array(${validator})`;
      const optional = optMark || hasDefault || isList || isUpdatedAt;
      cur.fields.push({ name: fname, validator, optional });
      if (isUnique) cur.uniques.push(fname);
    }
  }
}

// ── Build indexes per model ─────────────────────────────────────────────────
for (const mdl of models) {
  const idx = [];
  const seen = new Set();
  const fieldNames = new Set(mdl.fields.map(f => f.name));
  const add = (fields) => {
    const wanted = fields.filter(Boolean);
    // skip the whole index if any referenced field isn't a stored field
    // (guards against compound indexes referencing the dropped primary id)
    if (!wanted.length || !wanted.every(f => fieldNames.has(f))) return;
    const fs2 = wanted;
    const name = "by_" + fs2.join("_");
    if (seen.has(name)) return;
    seen.add(name);
    idx.push({ name, fields: fs2 });
  };
  for (const fk of mdl.fkFields) add([fk]);
  for (const u of mdl.uniques) add([u]);
  for (const c of mdl.compounds) add(c);
  mdl.indexes = idx;
}

// ── Emit validators.ts ──────────────────────────────────────────────────────
let vOut = `import { v } from "convex/values";\n\n`;
vOut += `/**\n * Convex validators for the 65 Prisma enums.\n *\n * Generated from prisma/schema.prisma (Phase 1 of the Convex migration).\n * Reused as field validators in convex/schema.ts and as mutation arg validators\n * in the per-domain function files (Phase 2). Keep in sync with the Prisma enums.\n */\n\n`;
for (const name of Object.keys(enums)) {
  const vals = enums[name];
  const lits = vals.map(x => `v.literal("${x}")`);
  if (lits.length === 1) vOut += `export const ${name} = ${lits[0]};\n`;
  else vOut += `export const ${name} = v.union(\n${lits.map(l => "  " + l).join(",\n")},\n);\n`;
}

// ── Emit schema.ts ──────────────────────────────────────────────────────────
let sOut = `import { defineSchema, defineTable } from "convex/server";\nimport { v } from "convex/values";\nimport * as enums from "./lib/validators";\n\n`;
sOut += `/**\n * GearFlow Convex schema — generated from prisma/schema.prisma (Phase 1).\n *\n * ${models.length} tables mirroring the Prisma models. Conventions:\n *  - Primary cuid \`@id\` becomes Convex's built-in \`_id\`; not stored explicitly.\n *  - Foreign keys are stored as \`v.string()\` (the source cuid) during the hybrid\n *    migration — NOT v.id() — so Convex docs interoperate with the existing\n *    Prisma id space and with auth-owned entities (user/organization) that stay\n *    in Better Auth. FK fields drive indexes. (Native v.id() is a post-data-\n *    migration optimization.) See FEATUREDOCS/54.\n *  - DateTime/Decimal -> v.number(); Json -> v.any(); enums -> ./lib/validators.\n *  - Optional iff the Prisma field is nullable, has a default, is a list, or is\n *    @updatedAt (so inserts/migration backfill aren't forced to set them).\n *  - createdAt/updatedAt are kept (optional) to preserve migrated timestamps;\n *    Convex also exposes _creationTime automatically.\n *  - @unique is NOT enforced by Convex indexes — uniqueness is enforced in the\n *    mutations that own each table. The by_<field> index still exists for lookup.\n *\n * Regenerate with: node scripts/generate-convex-schema.cjs . — if the Prisma\n * schema changes. Review by hand afterwards (generated scaffolding, not final).\n */\nexport default defineSchema({\n`;
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

// summary
console.log(`enums: ${Object.keys(enums).length}`);
console.log(`models: ${models.length}`);
console.log(`total fields: ${models.reduce((a, m) => a + m.fields.length, 0)}`);
console.log(`total indexes: ${models.reduce((a, m) => a + m.indexes.length, 0)}`);
const tn = models.map(m => m.key);
const dupes = tn.filter((x, i) => tn.indexOf(x) !== i);
if (dupes.length) console.log("DUPLICATE TABLE KEYS:", dupes);
console.log("table keys:", tn.join(", "));

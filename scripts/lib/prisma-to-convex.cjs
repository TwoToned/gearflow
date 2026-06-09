/* Shared Prisma-schema parser for the Convex generators.
 *
 * parse(root) reads <root>/prisma/schema.prisma and returns { enums, models }
 * with everything the schema generator (generate-convex-schema.cjs) and the CRUD
 * generator (generate-convex-crud.cjs) need. Single source of truth so the two
 * generators can never drift in field types, table names, or index naming.
 *
 * Conventions (see FEATUREDOCS/54):
 *  - Primary cuid `@id` -> stored `id: v.string()` + `by_cuid` index.
 *  - Foreign keys stay v.string() (cuid interop) and drive `by_<fk>` indexes.
 *  - DateTime/Decimal/Int/Float -> v.number(); Json -> v.any(); enum -> enums.X.
 *  - Optional iff nullable / has default / list / @updatedAt.
 */
const fs = require("fs");
const path = require("path");

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

const SCALAR = {
  String: "v.string()", Boolean: "v.boolean()", Int: "v.number()",
  Float: "v.number()", Decimal: "v.number()", DateTime: "v.number()",
  Json: "v.any()", BigInt: "v.int64()", Bytes: "v.bytes()",
};

function parse(root) {
  const raw = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const lines = raw.split("\n");

  // Pass 1: names
  const enumNames = new Set();
  const modelNames = new Set();
  for (const l of lines) {
    let m = l.match(/^enum\s+(\w+)\s*\{/);
    if (m) enumNames.add(m[1]);
    m = l.match(/^model\s+(\w+)\s*\{/);
    if (m) modelNames.add(m[1]);
  }
  const tableNameOf = {};
  for (const m of modelNames) tableNameOf[m] = tableKey(m);

  function mapType(base) {
    if (SCALAR[base]) return SCALAR[base];
    if (enumNames.has(base)) return `enums.${base}`;
    throw new Error("unexpected base type: " + base);
  }

  // Pass 2: enums
  const enums = {};
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

  // Pass 3: models
  const models = [];
  {
    let cur = null;
    for (const l of lines) {
      const m = l.match(/^model\s+(\w+)\s*\{/);
      if (m) { cur = { name: m[1], key: tableNameOf[m[1]], fields: [], fkFields: [], uniques: [], compounds: [], idField: null }; continue; }
      if (!cur) continue;
      if (l.match(/^\}/)) { models.push(cur); cur = null; continue; }
      const t = l.trim();
      if (!t || t.startsWith("//")) continue;

      let bm;
      if ((bm = t.match(/^@@unique\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if ((bm = t.match(/^@@index\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if ((bm = t.match(/^@@id\(\[([^\]]+)\]/))) { cur.compounds.push(bm[1].split(",").map(s => s.trim())); continue; }
      if (t.startsWith("@@")) continue;

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

      if (isObject) {
        const relm = attrs.match(/fields:\s*\[([^\]]+)\]/);
        if (relm) relm[1].split(",").forEach(s => cur.fkFields.push(s.trim()));
        continue;
      }
      if (isId) {
        // preserve cuid as stored, indexed `id` field (see FEATUREDOCS/54)
        let idValidator = mapType(base);
        if (isList) idValidator = `v.array(${idValidator})`;
        cur.fields.push({ name: fname, validator: idValidator, optional: false });
        cur.idField = fname;
        continue;
      }

      let validator = mapType(base);
      if (isList) validator = `v.array(${validator})`;
      const optional = optMark || hasDefault || isList || isUpdatedAt;
      cur.fields.push({ name: fname, validator, optional });
      if (isUnique) cur.uniques.push(fname);
    }
  }

  // Indexes + derived flags
  for (const mdl of models) {
    const fieldNames = new Set(mdl.fields.map(f => f.name));
    const idx = [];
    const seen = new Set();
    const add = (fields) => {
      const wanted = fields.filter(Boolean);
      if (!wanted.length || !wanted.every(f => fieldNames.has(f))) return;
      const name = "by_" + wanted.join("_");
      if (seen.has(name)) return;
      seen.add(name);
      idx.push({ name, fields: wanted });
    };
    if (mdl.idField && fieldNames.has(mdl.idField)) {
      idx.push({ name: "by_cuid", fields: [mdl.idField] });
      seen.add("by_cuid");
    }
    for (const fk of mdl.fkFields) add([fk]);
    for (const u of mdl.uniques) add([u]);
    for (const c of mdl.compounds) add(c);
    mdl.indexes = idx;
    mdl.orgScoped = fieldNames.has("organizationId");
    // first foreign key that is actually a stored field (for non-org list scoping)
    mdl.firstFk = mdl.fkFields.find(f => fieldNames.has(f)) || null;
  }

  return { enums, models };
}

module.exports = { parse };

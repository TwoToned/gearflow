# Verification prompt: PDF / document / report Prisma-decommission live round-trip

> Paste the section below into a fresh agent session running on a machine with the
> **Convex backend up** and a **Postgres DB with realistic data**. The code changes
> already landed and passed tsc / 2237 tests / lint / build headless — this session
> only does the one thing a headless container can't: confirm the Convex reads
> produce **the same values** the old Prisma joins did, against a live backend.

---

## TASK

You are verifying a completed Phase-6 Convex decommission on branch
`feat/convex-migration` (tip `c0cb57a0`). The document / report / export surface was
rewired so it reads **model, category, supplier, location, client** from Convex
(via `*-read.ts` attach helpers) instead of Prisma cross-domain joins. The change is
**designed to be data-identical** because those tables are dual-written to a fresh
Prisma mirror — your job is to PROVE that against a live backend, and catch the two
real failure modes a headless run can't:

1. **Incomplete mirror** — if a domain wasn't backfilled (or a row is missing in
   Convex), the map lookup returns `null` → a **blank cell / "Unknown" / dropped
   value**. This is the #1 risk.
2. **Wrong-key / wrong-field bug** in an attach helper → wrong or blank values
   (e.g. `preferredSupplierId` vs `supplierId`, or equipment-category vs
   `project_category`).

### READ FIRST
- `FEATUREDOCS/54-convex-data-layer.md` → the section **"PDF / document / report
  mirror-read decommission — ✅ DONE (2026-06-12 …)"** (the as-built record) and the
  **Phase 0 "Running"** block (how to bring up the Convex stack).
- `docs/designs/convex-pdf-decommission-session.md` (the build brief).

### The 6 files under test + their entry points
| file | entry point | callable from a script? |
|------|-------------|--------------------------|
| `src/lib/pdfme/build-document-data.ts` | `buildDocumentData(projectId, orgId, docType, …)` | ✅ explicit orgId |
| `src/lib/report-engine.ts` | `executeReport(config, orgId)` / `executeGroupedReport` | ✅ explicit orgId |
| `src/lib/reorder.ts` | `getReorderCandidatesCore(orgId)` / `createReorderDraftCore({…})` | ✅ explicit orgId |
| `src/server/csv.ts` | `exportModelsCSV/exportAssetsCSV/exportBulkAssetsCSV` | ❌ `"use server"` + `getOrgContext()` → verify via UI |
| `src/server/utilization.ts` | `getUtilizationSummary` | ❌ `requirePermission` → verify via UI |
| `src/server/warehouse-close.ts` | `getCloseOutSummary` | ❌ `requirePermission` → verify via UI |

## ENVIRONMENT
Same worktree quirks as before (see the build brief): `cp` the gitignored
`pnpm-workspace.yaml` into the worktree, `corepack pnpm install`, then **a REAL
`.env`** (not dummies) pointing at the Postgres DB **and** the Convex backend:
`DATABASE_URL`, `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`,
`NEXT_PUBLIC_CONVEX_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`NEXT_PUBLIC_APP_URL`. Bring the stack up:
```
docker compose -f docker-compose.convex.yml up -d
npx convex dev --once            # deploy schema + functions
./node_modules/.bin/prisma generate
```

## PROTOCOL

### Phase 0 — Mirror must be current (do this FIRST or everything reads blank)
Re-run the backfills for the domains under test and record the counts:
```
pnpm convex:backfill:models
pnpm convex:backfill:categories
pnpm convex:backfill:suppliers
pnpm convex:backfill:locations
pnpm convex:backfill:clients
```
Each prints `N/N mirrored`. If any is partial, STOP — fix the backfill before
verifying (a partial mirror is the blank-cell failure mode, not a code bug).

### Phase 1 — Count parity (the map-completeness gate)
For each org, assert the Convex list length == the Prisma table count. A mismatch
means the attach maps are incomplete → blanks downstream. Write a throwaway tsx
script (run `./node_modules/.bin/tsx scripts/verify-counts.ts`):
```ts
import { prisma } from "@/lib/prisma";
import { getModelsByOrg } from "@/lib/models-read";
import { getCategoriesByOrg } from "@/lib/categories-read";
import { getSuppliersByOrg } from "@/lib/suppliers-read";
import { getLocationsByOrg } from "@/lib/locations-read";

const orgId = process.argv[2]; // pass a real orgId
for (const [name, prismaCount, convex] of [
  ["models", await prisma.model.count({ where: { organizationId: orgId } }), (await getModelsByOrg(orgId)).length],
  ["categories", await prisma.category.count({ where: { organizationId: orgId } }), (await getCategoriesByOrg(orgId)).length],
  ["suppliers", await prisma.supplier.count({ where: { organizationId: orgId } }), (await getSuppliersByOrg(orgId)).length],
  ["locations", await prisma.location.count({ where: { organizationId: orgId } }), (await getLocationsByOrg(orgId)).length],
] as const) {
  console.log(`${name}: prisma=${prismaCount} convex=${convex} ${prismaCount === convex ? "✅" : "❌ MISMATCH"}`);
}
```
(NB models/suppliers/locations include archived rows — compare like-for-like; if a
backfill only copies active rows, scope the Prisma count the same way.)

### Phase 2 — Before/after VALUE parity (the rigorous check)
The gold standard: dump every cross-domain field the decommission touched, on the
**new tip** and on a **pre-decommission commit**, and diff. Pre-decommission baseline
= `30a2a547` (the commit right before `42264b1b`, the first code change).

Write `scripts/verify-decommission.ts` that, for a real `orgId` + a `projectId` with
rich equipment (assets with locations, a kit with children, a sub-hire with a
supplier, a bulk asset at/below reorder threshold), prints a STABLE, sorted dump:
```ts
import { buildDocumentData } from "@/lib/pdfme/build-document-data";
import { executeReport } from "@/lib/report-engine";
import { getReorderCandidatesCore } from "@/lib/reorder";

const orgId = process.argv[2], projectId = process.argv[3];

// 1) PDF document data — venue + per-line model/category/supplier/location/client
const doc = await buildDocumentData(projectId, orgId, "delivery-docket");
const flat = (items: any[]): any[] => items.flatMap((i) => [i, ...flat(i.childLineItems ?? [])]);
console.log("VENUE", doc.venue_name, "|", doc.venue_address, "| CLIENT", doc.client_name);
for (const li of flat(doc.line_items).sort((a,b)=> (a.id>b.id?1:-1)))
  console.log("LI", li.id, "| model:", li.model?.name ?? "", "| cat:", li.model?.category?.name ?? li.categoryName ?? "", "| supp:", li.supplierName ?? "", "| loc:", li.locationName ?? "");

// 2) reports — run assets / models / kits / lineItems sources with the cross-domain columns
//    (build a ReportConfig per source with model.name, model.category.name, location.name,
//     supplier.name, category.name as applicable; print each flat row sorted by id)

// 3) reorder candidates — modelName / categoryName / preferredSupplier / locationName
for (const c of (await getReorderCandidatesCore(orgId)).sort((a,b)=> (a.bulkAssetId>b.bulkAssetId?1:-1)))
  console.log("REORDER", c.bulkAssetId, c.modelName, "|", c.categoryName, "|", c.preferredSupplier?.name ?? "", "|", c.locationName ?? "");
```
Run it on the new tip → `new.txt`. Then `git stash` any throwaway scripts,
`git checkout 30a2a547`, re-add the script, run → `old.txt`, `git checkout -` back.
**`diff old.txt new.txt` must be empty.** Any difference is a real regression — most
likely an incomplete mirror (Phase 0/1) or a key bug; investigate before signing off.
(Tip: keep the script identical across both checkouts — paste it from outside the repo
so the checkout doesn't clobber it, or stash/pop it.)

### Phase 3 — Auth-gated paths via the UI (`/browse` from gstack)
Log in (`/setup-browser-cookies` if needed) and eyeball for blanks/"Unknown":
- **Reports page** — run a report on the *assets* source with columns Model Name,
  Category, Location, Supplier; and the *models* source with Category. Values present,
  and the column **sorts** still order correctly (sorts stay on the fresh Prisma
  mirror — a broken sort would be a real finding).
- **CSV exports** — export Models / Assets / Bulk Assets; open the files; confirm the
  `category` / `modelName` / `locationName` / `supplierName` columns are populated.
- **Reorder dashboard** — model/category/supplier/location columns populated; create a
  draft order and confirm the line description reads `"<model name> — restock (<tag>)"`.
- **Document generation** — generate a delivery docket + a quote + a packing list for
  the rich project; confirm equipment model names, the packing-list **Category**
  column, sub-hire **"via <Supplier>"**, packer **location** grouping, and the
  **venue** name/address all render (compare against a doc generated from prod / the
  old build if you can).

### Phase 4 — The excluded integration test
`reorder.int.test.ts` is excluded from the default suite and now reads model names
from Convex (same dependency `createReorderDraftCore` already had via
`getSupplierById`). Run it against the live DB + Convex and record the result:
```
./node_modules/.bin/vitest run --project integration src/lib/reorder.int.test.ts   # adjust to the repo's int-test runner
```
Its fixtures are Prisma-only, so if the harness doesn't dual-write models to Convex,
`getReorderCandidatesCore`'s `modelName` will be blank — but its assertions check
thresholds/quantities/isolation, **not** model names, so it should still pass. If it
fails, note whether it's the (pre-existing) Convex-fixture gap vs a real regression.

## PASS CRITERIA
- Phase 1: all 4 domains count-parity ✅.
- Phase 2: `diff old.txt new.txt` empty.
- Phase 3: no unexpected blanks; report sorts correct; docket/quote render with all
  cross-domain values.
- Phase 4: int test passes (or fails only on the documented Convex-fixture gap).

## AFTER
Add a short **"Live round-trip verification — ✅ / ⚠️"** note to the
"PDF / document / report mirror-read decommission" section of `FEATUREDOCS/54`
(date, org/project used, the count-parity numbers, the diff result, any findings).
If a regression turns up: a **blank where data exists** is almost always an
incomplete mirror → re-run the relevant `convex:backfill:*`; a **wrong value** is a
key/field bug in the attach helper → fix + re-verify. No new Convex table/fn is
expected; flag if that changes (would need a JWKS round-trip).

# Session brief: PDF / document-generation Prisma decommission

> **STATUS: ✅ DONE (2026-06-12, Tier 1 + 2).** Executed on `feat/convex-migration`
> (commits `42264b1b` → `47e4821e`). See the "PDF / document / report mirror-read
> decommission" section in `FEATUREDOCS/54` for the as-built record. The remaining
> follow-ups (Tier 3 warehouse hot-path joins; supplier/location report relations)
> are noted there and at the bottom of this brief. Everything below is the original
> plan, kept for reference. Verification still needs the **live round-trip**
> (report with model/category columns; docket + quote render; Convex count == Prisma
> count) — code/tsc/tests/lint/build were all green in the headless container.

**Phase 6 of the Convex hybrid migration.** Self-contained, one-session scope.
Rewire the remaining cross-domain Prisma "mirror" reads in the document / report /
export *file-generation* surface onto the Convex `attach*` helpers. After this,
nothing that generates a PDF/CSV/report reads cross-domain model/category/location
data from Prisma.

> **Read first:** `FEATUREDOCS/54-convex-data-layer.md` (the migration record) and
> the **"PDF generation — data-shape changes need cross-cutting audits"** section
> of `CLAUDE.md`. This brief was produced by a scoping pass on 2026-06-11; verify
> `file:line` refs before editing (they drift).

## The key finding that makes this small and low-risk

The **true PDF pipeline is already off the mirror.** `build-document-data.ts` no
longer Prisma-joins the dangerous cross-domain data:

- Line-item **model + nested category + supplier** are attached from Convex via
  `attachLineItemTree` (`src/lib/line-item-tree-read.ts`); `lineItemInclude`
  deliberately omits `model`/`supplier`.
- **Client** comes from `getClientById` (`clients-read.ts`).
- **There are ZERO `*_media` / photo reads in the PDF pipeline** (verified by grep).

The **five `DocumentLineItem` consumers** (`gearflow-table.ts` rendering + plugin
status-filter + docket bucketing; `section-renderer.ts` `calculateItemHeight` +
`getFilteredParentItems`) are **pure functions of the pre-built
`DocumentLineItem[]`** — neither file imports Prisma, Convex, or any `*-read` lib.
**Therefore: swapping a data SOURCE upstream is safe for all 5 at once, as long as
the emitted `DocumentLineItem` shape stays byte-identical.** This work changes only
where fields are sourced, never the shape — so the CLAUDE.md "fix-one-consumer,
ship-three-bugs" footgun does not apply. Keep it that way: **do not add/rename/
restructure any `DocumentLineItem` field.**

## Toolkit (all already built — reuse, don't reinvent)

`src/lib/*-read.ts`: `models-read` (`getModelMap`/`attachModel`), `categories-read`
(`getCategoryMap`), `locations-read` (`getLocationMap`/`attachLocation`),
`suppliers-read` (`getSupplierMap`/`attachSupplier`), `line-item-tree-read`
(`buildLineItemAttachMaps`/`attachLineItemTree`). Pattern: fetch the Prisma rows
**without** the cross-domain join, then attach from a Convex map keyed by the FK.

## Scope — Tier 1 + Tier 2

### Tier 1 — true PDF document path

1. **`build-document-data.ts` — location reads (the one core gap).**
   `project.location` and the per-asset/bulk `location` joins that derive
   `locationName` are still raw Prisma. Locations were cut over, so source them from
   `locations-read` (`getLocationMap(orgId)` + resolve `locationName` from the map).
   - Drop `location` from the project/asset Prisma `include`s; resolve names from the
     Convex location map in the existing enrichment block.
   - **`locationName` already exists on `DocumentLineItem`** → shape unchanged → all
     5 consumers safe.
   - There's also a project-level `location` used for branding/header — source that
     from the same map.

2. **`server/documents.ts` — `getProjectForDocument` (`~:23`, raw `model:{category}`).**
   It has **no callers** in the tree. **Verify dead** (`grep -rn getProjectForDocument
   src/`), then **delete the function** (cleaner than rewiring dead code). If a caller
   turns up, instead rewire it to `attachLineItemTree` like `build-document-data`.

### Tier 2 — report / export generators (established `attach*` pattern)

Each is a flat "drop the Prisma join, attach from a Convex map" swap. No shape
constraints (these don't feed `DocumentLineItem`).

3. **`report-engine.ts:~152`** — `include.model = { include: { category: true } }`.
   Mirror the existing `attachClientsToRows` already in this file: add a
   models+categories post-fetch attach (`getModelMap` + `getCategoryMap`). This is
   the highest-value Tier-2 item (dynamic report builder → `generateReportPdf`).
4. **`csv.ts:~45,102,155`** — `exportModelsCSV` / `exportAssetsCSV` /
   `exportBulkAssetsCSV` model+category. (`csv.ts` already uses `attachSupplier`, so
   the file already has the pattern + imports.)
5. **`reorder.ts:~51,125`** — `getReorderCandidatesCore` + `createReorderDraftCore`
   model/category.
6. **`utilization.ts:~84`** — utilization report model/category.
7. **`warehouse-close.ts:~47`** — warehouse-close report `model.name`.

### Explicitly OUT of scope (separate later session)

- **Tier 3 warehouse hot-path model joins** (`warehouse.ts:846,892,1101,1561,1699,1725`)
  — operational reads (packing/docket/scan/container), not file generation, higher
  frequency/blast-radius. Own session.
- **`*_media`/file joins, RBAC/`custom_role`/`activityLog`** — stay Prisma (and media
  isn't in this pipeline anyway).
- **`sample-document-data.ts`** — hardcoded fixture for template-preview; not a DB
  read. Leave.

## Test gap to close (do this in the Tier 1 commit)

The full-pipeline integration test `src/lib/pdfme/line-item-tree-attach.test.ts`
("full PDF pipeline parity" block) chains attach → structureLineItems →
`getFilteredParentItems` → `runTablePlugin`, but does **not** assert through
`calculateItemHeight` (consumer #2 — the v0.8.1.1 tail-drop class). Add a
height-calc/`estimateSectionHeight` assertion over the same realistic fixture so a
future shape change can't silently drop tail items. Also extend the parity fixture
to assert `locationName` survives the Convex-sourced swap.

## Verification protocol (per commit)

Env: copy `pnpm-workspace.yaml` into the worktree (gitignored), `corepack pnpm
install`, dummy `.env`, `./node_modules/.bin/prisma generate`. Run binaries via
`./node_modules/.bin/`.

- `tsc --noEmit` clean (after deletes, re-run `next build` to regen `.next/types`).
- `vitest run` — baseline **2235**, runs without a DB; adjust only for the new
  height-calc assertion you add.
- 0 new lint via normalized base-vs-HEAD compare (`eslint --format json` →
  `file|rule|severity`, `LC_ALL=C sort`, `comm -13`).
- `next build` exit 0.
- **Live round-trip (needs Convex backend up):** for each rewired domain, confirm the
  Convex map count == Prisma count for a sample org, and render one real document
  (delivery docket + quote) before/after to eyeball model/category/location parity.
  This is the only step that needs the backend — do it last.

Commit atomically (one site/concern per commit), push each to
`origin/feat/convex-migration`. No new Convex table/fn expected — flag if that
changes (would need a JWKS round-trip).

## After

Update `FEATUREDOCS/54` (mark the document/report/export mirror-reads decommission
done; note Tier 3 warehouse + infra-only reactive readers + truncate/backfill as
what remains) and the Phase-6 roadmap-table row.

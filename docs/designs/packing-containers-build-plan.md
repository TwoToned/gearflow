# Packing containers + manifest — build plan

> _Owner: Jayden Nawotka · Created: 2026-09-27 · Status: **DRAFT — awaiting go** · Review quarterly (POLICY.md R-5.5)_

**Companion to** [`packing-containers-manifest.md`](./packing-containers-manifest.md), which is the
design: the as-built audit, the decisions (D1–D11), the model, the documents and the surfaces.
**This doc is the execution order**: what to do, in what sequence, with what acceptance. Where the
two disagree, the design doc wins and this one is stale.

**Tracking:** one issue per phase, filed on go (none yet).

---

## The sequence, and why it is this order

```
0  Pin the defects ─────────────────┐   runtime repros of what is broken today, so
                                    │   phase 1 has a red test to turn green
1  The spine ───────────────────────┤   projectContainers + units.containerId,
   1a schema + reads                │   backfill, roll-up on units; old string
   1b writes                        │   fields still readable (widen)
   1c prep/checkout rewire          │
   1d backfill + driver             │
        │                           │
        ├── 2 Warehouse UI ─────────┤   rail, container headers, move, deploy-by-
        │                           │   container; needs only phase 1
        ├── 3 Documents ────────────┤   byContainer structuring, manifest, docket
        │                           │   rework; needs only phase 1
        └── 4 Packing tab ──────────┤   planning; needs 1 + the tree pieces of 3
                                    │
5  Narrow + retire ─────────────────┤   drop prepContainer strings, retire the
                                    │   label-keyed ops, rewrite FEATUREDOCS/32
6  Later ───────────────────────────┘   labels (Q14), bulk-tub picker (D2)
```

Five rules govern the order. None is negotiable.

1. **Readers before the backfill.** Convex deploys functions separately from data. Every reader
   of `prepContainer` (warehouse tabs, `syncContainersBatch`, `clearPrepContainer`, the PDF
   pipeline, `warehouse-stages.ts`) must read `containerId` with a string fallback and be live
   BEFORE `backfillProjectContainers` rewrites a single row, or the Prepped tab goes blank
   mid-migration.
2. **Widen → migrate → narrow.** `projectLineItems.prepContainer` and
   `projectLineItemUnits.prepContainer` stay in the schema, readable, until the backfill is
   confirmed in prod (the WS9 `clientContacts` precedent). Phase 5 drops them.
3. **The PDF shape change ships with the audit.** `DocumentLineItem` gains a synthetic container
   row. CLAUDE.md's rule applies in full: both consumers (`line-items-table.tsx` render +
   `filterAndGroupItems`'s status filter) plus `structureLineItems`, `build-document-data.ts`
   totals, a full-pipeline integration test and `regression.test.tsx`, in the SAME PR as the shape.
4. **Containers are never priced (D5).** No phase adds a `unitPrice`, a rate lookup, or a
   quote/invoice path for a container line. A PR that does is defective even if it works.
5. **Stable API surface holds.** `warehouseWrites.syncContainersBatch` is wrapped by the curated
   MCP tool `stage_pick_list`, so it is `stability: "stable"`: `pnpm run api:registry` refuses to
   run if it disappears, loses a field, or is demoted. Its name and args stay; its body is
   reimplemented over the new model (label → container lookup within the project). A real
   breaking change needs a `/v2`, which nothing here justifies.

---

## Phase 0 — Pin the defects

**Effort:** human ~½ day / CC ~1 hr. **Depends on:** nothing. **Blocks:** 1.

The design doc's defect list (§1.5) was established by reading, not by running. Turn the two
that matter into failing tests so phase 1 has something to turn green, and so nobody can argue
the old shape "worked".

- [ ] `convex/prepContainer.repro.test.ts` (convex-test): prep a serialised asset via
      `checkRecordOps.prepItems` with a container label, then assert `syncContainersBatch` does
      NOT flip the container line (contents are on the unit, the roll-up reads the line) and the
      Deploy-tab grouping input (line-level `prepContainer`) is unset. Mark `it.fails` today so it
      flips to green in 1c.
- [ ] `src/lib/pdfme/container-grouping.repro.test.ts`: run `structureLineItems` in expand mode on
      a line with `prepContainer` set and assert the emitted `groupName` is the category, proving
      the container never reaches the PDF. Same `it.fails` treatment; phase 3 replaces it.
- [ ] Commit the rendered-fixture critique inputs: the throwaway vitest render used for the docket
      screenshots becomes `src/lib/react-pdf/render-fixtures.test.tsx` (`describe.skip` by default,
      one env flag to write PDFs to a scratch dir). Cheap, and it is how phase 3 shows before/after.

**Acceptance:** two red tests on `main` that describe the bug precisely, one skipped render helper.

---

## Phase 1 — The spine: model, backfill, roll-up on units

**Effort:** human ~5 days / CC ~8 hrs. **Depends on:** 0. **Blocks:** 2, 3, 4.

Four PRs, each under the T-2 400-LOC target. Order matters (rule 1).

### 1a — Schema + reads

- [ ] `convex/schema.ts` (hand-merged, never regenerated): `projectContainers` per design §3.2 —
      `kind: "ASSET" | "BULK_ASSET" | "CUSTOM"`, `assetId?`, `bulkAssetId?`, `label`,
      `description?`, `lineItemId`, `parentContainerId?`, `sortOrder`, `versionId`, `lineageId`.
      Indexes: `by_cuid`, `by_organizationId`, `by_versionId`, `by_lineItemId`, `by_assetId`,
      `by_bulkAssetId`, `by_parentContainerId`. No `by_projectId` — `scripts/version-scope-ratchet.mjs`
      forbids it; all plan reads go through `versionRows`/`liveRows` (`convex/lib/versionScope.ts`).
- [ ] `projectLineItemUnits.containerId?: string` + index `by_containerId`.
      `projectLineItems.plannedContainerId?: string` (plan, D9) and
      `projectLineItems.containerId?: string` on container line items only (reverse lookup).
      `prepContainer` stays on both tables (rule 2). Add `projectContainers` to
      `VersionedTableName` in `versionScope.ts` so `versionRows` accepts it.
- [ ] `scripts/org-export-tables.ts`: classify `projectContainers`, bump `EXPECTED_TABLE_COUNT`
      125 → 126, or `convex/orgExport.test.ts` fails.
- [ ] `convex/projectContainers.ts` (new module): `listForProject(orgId, projectId, versionId?)`
      returning containers + per-container unit counts (one `by_containerId` range per container,
      bounded by the version's container count), guarded by
      `requireOrgReadFor(ctx, orgId, "warehouse")` and org-checked on every `by_cuid`/`by_assetId`
      hit (`scripts/xtenant-bycuid-ratchet.mjs` baseline is 0). Colocated `agentOps` summary.
- [ ] Hand-edit `convex/_generated/api.d.ts`: two lines per new module (`convex codegen` needs a
      deployment; CLAUDE.md). Same for 1b's writes module and 1d's backfill module.
- [ ] `src/lib/project-line-item-read.ts`, `src/lib/project-equipment-reconstruct.ts`: map the new
      fields; derive `containerIds: string[]` per line from its units (`distinct(unit.containerId)`),
      with `prepContainer` as the fallback source until phase 5.
- [ ] `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp`, commit all three.

### 1b — Writes

- [ ] `convex/projectContainersWrites.ts` (new): `createNative` (kind + asset/bulk/custom, mints the
      container's line item in the same transaction with `isContainerLineItem: true`, `containerId`,
      `type: "EQUIPMENT"`, `isCustomItem: true` for CUSTOM, no price — D5), `updateNative` (label,
      description, `parentContainerId` with a cycle check), `deleteNative` (refuses with a
      `ConvexError` when any unit is inside; deletes container + line item together — fixes defect
      6), `moveUnitsNative(unitIds, toContainerId | null)` (the missing operation behind defect 7),
      `unpackNative(containerId)` (contents → loose; replaces `clearPrepContainer`'s job),
      `setPlannedContainerNative(lineItemIds, containerId | null)` (D9, used by phase 4).
- [ ] Server-side bounds mirror the Zod schema (`convex/lib/fieldGuards.ts`): label ≤ 120,
      description ≤ 500, `unitIds` ≤ 500. Zod schema in `src/lib/validations/project-container.ts`,
      form types via `z.input`.
- [ ] Every write resolves the live version with `resolveWriteVersionId` and passes the lifecycle
      guard as a structural add (Q16 default: allowed on `CONFIRMED`+, the `unplanned` allowance).
      No argument named `force*`/`allow*`/`justification` — nothing here softens a gate, so
      `src/lib/api/privileged-args.ts` stays untouched.
- [ ] `agentOps` danger: `createNative`/`updateNative`/`setPlannedContainerNative` low,
      `moveUnitsNative`/`unpackNative` medium (bookkeeping, no stock movement), `deleteNative` high
      (delete family → API `confirm: true` gate). `assertBulkSizeOk` on `moveUnitsNative`.
- [ ] `src/hooks/use-project-container-writes.ts` (new; mirrors `use-warehouse-writes.ts`'s shape).
- [ ] `logActivity` parity: one audit row per create/delete/move, none for label edits.
- [ ] Tests: `convex/projectContainersWrites.test.ts` (convex-test) — create each kind, nested
      cycle rejected, delete-with-contents rejected, move across containers, unpack, cross-org
      rejection. `convex/xtenantExhaustive.test.ts` picks the new operations up from the registry
      automatically; make sure the `listBy*` proof passes (seed one container per org).

### 1c — Prep, checkout and return rewire

- [ ] `convex/lib/fulfillment.ts` `prepUnit`: `containerId?: string | null` replaces
      `prepContainer`; when absent, default to the line's `plannedContainerId` (D9). Accessory
      units inherit (existing shape at `:931-941`). During widen, keep writing the label to
      `prepContainer` too, derived from the container, so any not-yet-migrated reader still works.
- [ ] Thread the id through `checkRecordOps.prepItems`, `checkRecordWrites.completeCheckAndPack`,
      `warehouseWrites.quickAddAndCheckOut`, `src/server/check-records.ts` (`prepItemDirect`,
      `prepItemsBatch`), `src/hooks/use-check-record-writes.ts`, `use-warehouse-writes.ts`. Accept
      BOTH `containerId` and the legacy `prepContainer` arg for one release; the legacy arg resolves
      to a container by label (creating a CUSTOM one if none) so old clients keep working.
- [ ] Container status roll-up moves server-side: `syncContainerStatuses(ctx, containerIds)` in
      `convex/lib/fulfillment.ts` reads units `by_containerId` (nested containers count as members),
      and is called ONCE at the end of `checkOutItems`/`checkInItems`/`checkOutKit`/`checkInKit`
      cores in `convex/warehouseOps.ts` — the page's follow-up `syncContainersBatch` calls
      (`page.tsx:770-792`) are deleted. `warehouseWrites.syncContainersBatch` stays as the stable
      shim (rule 5) that maps labels → containers and calls the same core.
- [ ] `ensureContainerOnProject` becomes a thin shim over `projectContainersWrites.createNative`
      (kind ASSET, idempotent on `by_assetId` + version), `clearPrepContainer` over `unpackNative`.
      Both keep their names until phase 5.
- [ ] `convex/lib/projectAutoStatus.ts:221`, `warehouse-stages.ts:107`, `allocation.ts:192`,
      `roi.ts:156`: unchanged — they key on `isContainerLineItem`, which every container line still
      carries.
- [ ] `convex/lib/versionReality.ts`: a container line whose contents are `CHECKED_OUT` is reality
      the same way its units are. Carry the container row + its line across `makeLiveNative` by
      lineage, or a new version silently drops the case that is physically on site (design §8).
      Test in `convex/versions.test.ts` (or wherever `carryRealityByLineage` is covered).
- [ ] Phase 0's `prepContainer.repro.test.ts` goes green here; rename it to the real test.

### 1d — Backfill

- [ ] `convex/backfillProjectContainers.ts` (mirrors `backfillKitUnits.ts`): SERVICE-only, paginated
      over `projectLineItemUnits` then `projectLineItems`, `apply: false` dry-run, idempotent. Per
      `(project version, distinct label)`: create ONE container — `ASSET` when a line with
      `isContainerLineItem` + that label exists on the version (reuse its line item, stamp
      `containerId`), else `CUSTOM` (mint the line item). Stamp `unit.containerId` from the unit's
      label first, the line's label as fallback. Nothing is deleted.
- [ ] `scripts/convex-backfill-project-containers.ts` driver (pages until `isDone`), run against a
      preview deployment first (`pnpm exec convex deploy --preview-name …`), then prod after 1a–1c
      are deployed (rule 1).
- [ ] Post-run assertion query: zero units with a `prepContainer` and no `containerId`.

**Acceptance (phase 1):** a serialised asset prepped into a case shows under that case in the
Deploy tab and the case auto-deploys when its last unit goes out (the phase 0 repro is green);
`pnpm test`, `pnpm lint`, `npx tsc --noEmit`, `pnpm run api:registry:check`, both ratchets and
`orgExport.test.ts` pass; `docs/api-coverage.md` gains the new operations with no unreasoned
denial.

---

## Phase 2 — Warehouse UI

**Effort:** human ~5 days / CC ~7 hrs. **Depends on:** 1. **Parallel with:** 3.

Mockups: the "Warehouse" and "Sheets, dialogs and mobile" rows of the canvas (design §5).

- [ ] **Container rail** (`src/components/warehouse/container-rail.tsx`, new): reads
      `projectContainers.listForProject`; "Loose" first (dashed), one chip per container with unit
      count, nested chips indented, "+ New". Exactly one active. Desktop: right column of the Pick
      tab (`pick-prep-tab.tsx`, replacing the 12rem `ComboboxPicker` at `:145-153`); mobile:
      horizontal scroller above the sticky scan field. Active container state replaces
      `selectedContainer`/`selectedContainerAssetRef` in `page.tsx` (`:361`, `:1600-1610`).
- [ ] **Scan-to-activate**: a scanned tag that resolves to an asset whose model is a container
      (`models.isContainer` or in a container category) switches the active chip instead of
      erroring "not on this job"; it creates the container (1b `createNative`, kind ASSET) if it
      isn't on the job yet. One decision point in `page.tsx`'s scan handler, tested in isolation
      (`src/lib/warehouse-scan-route.ts` + test) rather than inside the 3,600-line page.
- [ ] **New container sheet** (`new-container-sheet.tsx`, Radix `Sheet`, `asChild`): asset search
      (extends `convex/categories.ts` `containerAssetSearch` to several categories + the model flag,
      returns availability), Custom tab, description, "Packed inside" parent picker (Radix
      `Popover`-based `combobox-picker.tsx`, never Base UI inside a Dialog — CLAUDE.md). Bulk-tub
      rows render disabled with "later" (D2).
- [ ] **Prepped / Return / De-prep tabs**: group by the UNIT's container (via the derived
      `containerIds`), not the line label. `deploy-tab.tsx:248-290` headers become container
      headers: label, tag, kind pill, description, `n items`, actions Deploy container / Move… /
      Edit / more. Nested containers indent. "No container" → "Loose" with "Pack into…". The X
      "remove container" becomes Unpack (1b). `groupItems`'s `\0container` key suffix
      (`page.tsx:221-224`, `:290-292`) keys on container id.
- [ ] **Move to…** (`move-to-container-sheet.tsx`): row-level and multi-select; bottom sheet on
      mobile. Calls `moveUnitsNative`. Selection bar on Prepped: Deploy · Move to… · Move to Pick.
- [ ] **Deploy container (D4)** (`deploy-container-dialog.tsx`): lift the `kitConfirm` dialog
      (`page.tsx:425`, `:3042-3070`) into a shared component that takes a member list; the
      container path passes its units (nested containers expanded) and calls the existing
      `checkOutItems` with `includeAccessoryIds`-style verified-only filtering. No new mutation.
- [ ] **Equipment tab**: `equipment-row-descriptors.ts` gains `source: "container"`; the row
      renders a **Container** badge and is read-only for price (D5). A line with a
      `plannedContainerId` or any `containerIds` shows a small container chip (read-only; edited
      on Packing, phase 4).
- [ ] **Settings → Assets**: "Prep Containers" becomes "Containers": several categories
      (`containerCategoryIds: string[]` in `src/lib/org-settings-types.ts`, `prepKitCategoryId`
      read as fallback until phase 5) and the per-model `isContainer` flag on the model form.
- [ ] Every new overlay gets a jsdom smoke test that RENDERS it (the `TooltipProvider` footgun,
      CLAUDE.md). Menus are tested by opening them.

**Acceptance:** a packer can scan a case, scan gear into it, see it under the case in Prepped,
move a unit to another box, deploy the whole case with the verify dialog, and never sees a
container in the Pick list as gear to pick. Mobile rail works at 390 px with no horizontal page
scroll.

---

## Phase 3 — Documents: manifest, docket rework, return sheet

**Effort:** human ~5 days / CC ~7 hrs. **Depends on:** 1. **Parallel with:** 2.

Mockups: the "Documents" row. Rule 3 applies to every PR here.

### 3a — Data shape + `byContainer` structuring

- [ ] `src/lib/pdfme/types.ts`: `DocumentType` gains `"manifest"`; `DocumentLineItem` gains
      `containerId?`, `containerLabel?`, and the synthetic row fields `isContainerRow?`,
      `containerKind?`, `containerTag?`, `containerDescription?`, `containerDepth?`,
      `containerItemCount?`; `DocumentData` gains `container_count`, `nested_container_count`,
      `loose_item_count`, `total_weight_kg` (already computed at `build-document-data.ts:680`, never
      printed), `delivery_address` (= `venue_address`, already loaded).
- [ ] `src/lib/pdfme/structure-line-items.ts`: `StructureOptions.byContainer?: boolean`. When on
      (and `expandProjectGroups` is on), bucket by `unit.containerId` FIRST, emitting one container
      row per container in `sortOrder`, nested rows after their parent with `containerDepth + 1`,
      then category → kit → line inside each; kit members packed elsewhere emit once under their
      actual container with a `fromKitName` note (D3); Loose last; `isContainerLineItem` lines are
      excluded as GEAR (they are the headers now). Status of a container row is DERIVED from its
      members (CLAUDE.md synthetic-row rule), never hard-coded.
- [ ] `src/lib/pdfme/build-document-data.ts`: load `projectContainers` for the live version, join
      units → containers, pass `byContainer` for `manifest`/`delivery-docket`/`return-sheet`;
      `total_items` must not count container lines; `total_weight_kg` includes a case when its
      model has a weight.
- [ ] `src/lib/react-pdf/components/line-items-table.tsx`: `filterAndGroupItems` — a container row
      passes the status filter iff any member passes (same shape as `isGroupRow`); delete the
      delivery-docket kit-promotion special case (TODOS.md's standing P3) now that the kit prints
      its own row. Render: `ContainerHeaderRow` (band with label/tag/kind/count, description line,
      indent per depth), `showTagsInline` (tags joined in the tag cell, no per-unit sub-rows), and
      `showRowNumbers` counts printed parent rows only.
- [ ] Tests, same PR: `line-items-table.test.ts` (container row filter cases, nested depth,
      stray kit member once), a new full-pipeline test in the style of
      `document-data-reconstruction.test.tsx` on a packed fixture (`fixture.ts` gains
      `makePackedFixture()`), `regression.test.tsx` extended to the 6th doc type (header/footer
      furniture, no tail drop, group-header-once). Phase 0's PDF repro goes green.

### 3b — Manifest document

- [ ] `src/lib/react-pdf/manifest-document.tsx`: header, job strip, deliver-to + "what is on site"
      summary, table `Item | Qty | Asset tags`, continuous list (D8), no checkboxes (Q10 default),
      no prices, footer. `render.tsx` switch case, `document-layouts.ts` entry
      (`expandProjectGroups: true`), `generate-pdf.ts` needs no change.
- [ ] Routes and API: `src/app/api/documents/[projectId]/route.tsx` `typeMap.manifest`
      (`project:read`); `src/lib/api/documents.ts` `AGENT_DOCUMENT_TYPES` + `LIVE_RENDER_TYPES`;
      `src/lib/api/mcp/curated-tool-defs.ts` `get_project_document` enum + prose (additive, so the
      stable-contract baseline accepts it); `pnpm run api:docs && pnpm run api:mcp`.
- [ ] Entry points: project page Documents ▾ (`projects/[id]/page.tsx:473-475`) gains "Manifest";
      the warehouse page header and the Packing tab get "Print manifest".
- [ ] `manifest-document.test.ts` (page count, empty, nested, every header mode).

### 3c — Delivery docket rework + return sheet

- [ ] `delivery-docket-document.tsx`: sentence-case title; a `fixed` job strip under the header
      (project number · name · delivered · return due); parties row via `details-row.tsx`
      `showDeliveryAddress` + `showDeliveredBy` columns; "This delivery" summary; table in
      container order with columns `# | Item | Qty | Asset tags` (no Received column, D7, no
      per-unit rows, no pre-ticked boxes); condition-on-receipt ruled box; `signature-line.tsx`
      gains a `rows` shape (Name / Company / Signature / Date-time per column) and drops the
      duplicated "Signature" sub-line.
- [ ] `return-sheet-document.tsx`: `byContainer`, a "case returned ☐" row per container (the
      container each unit LEFT in, D10).
- [ ] Before/after PDFs from phase 0's render helper attached to the PR.
- [ ] Docs in the same PRs: FEATUREDOCS/13 (6 doc types, `byContainer`, consumer list), FEATUREDOCS/32
      §"PDF Documents" corrected, FEATUREDOCS/56 + `docs/api-coverage.md` (regenerated), glossary
      ("Manifest", "Packing slip" rule), `.claude/skills/rvlt-flow/SKILL.md` document table.

**Acceptance:** `manifest` renders for a packed project with nested containers and a split kit and
matches the mockup's structure; the docket has no pre-ticked boxes, prints the delivery address,
and signs once; `pnpm test` (incl. the 6-type regression harness) green; `api:registry:check`
green.

---

## Phase 4 — Packing tab (planning)

**Effort:** human ~4 days / CC ~5 hrs. **Depends on:** 1 (data), 3a (the tree shaping) — not 3b/3c.

Mockup: "Project · Packing tab (planning)".

- [ ] `src/app/(app)/projects/[id]/page.tsx`: `VALID_TABS` gains `"packing"` (after
      `"equipment"`), a `TabsTrigger` + `TabsContent`; the context sidebar renders on it like every
      non-Overview tab (FEATUREDOCS/69). `?tab=packing` deep-links resolve.
- [ ] `src/components/projects/packing-tab.tsx` (new): container cards (drag handle, label, tag,
      kind, description, `n lines · x of y packed`, Edit), lines inside with `Planned` (muted
      italic) vs the green `Packed` pill from the unit reality, nested cards indented, a dashed
      **Not planned** bucket last, toolbar: summary line, "n lines not planned" chip, Print
      manifest, + Container (reuses phase 2's sheet).
- [ ] Drag: `src/lib/packing-drag.ts` (pure, tested) resolving line → container / container →
      parent moves, modelled on `resolveLineItemDragAction`/`buildContainerMap` (FEATUREDOCS/47);
      writes via `setPlannedContainerNative` and `updateNative(parentContainerId)`. Uses the same
      `structureLineItems({ byContainer })` output as the manifest so screen and PDF cannot
      disagree (R-3.1), with planned membership substituted where no unit has landed.
- [ ] Pick tab (phase 2's table) shows `Planned: <container>` under a line once this populates;
      `prepUnit` already defaults to it (1c).
- [ ] `src/lib/project-readiness-checks.ts`: `packingCheck` — `unknown` when the project has no
      containers (never a false pass), `fail` with "n lines not planned" otherwise, `pass` at zero;
      the Overview row navigates to `packing`. Table-level test alongside the existing checks.
- [ ] jsdom smoke test rendering the tab with a packed + planned fixture; drag helper unit tests.

**Acceptance:** a PM can create boxes and drag lines into them before the warehouse starts; the
warehouse's actual packing overrides the plan visibly; Overview shows the not-planned row and lands
on the tab.

---

## Phase 5 — Narrow and retire

**Effort:** human ~2 days / CC ~3 hrs. **Depends on:** 1d confirmed in prod, 2, 3, 4 shipped.

- [ ] Drop `prepContainer` from `projectLineItems` and `projectLineItemUnits` in `convex/schema.ts`;
      delete every fallback read added in 1a/1c; delete the label → container resolution in 1c's
      legacy-arg path.
- [ ] Retire `warehouseWrites.ensureContainerOnProject` and `clearPrepContainer` (not stable-tier;
      registry accepts their removal). `syncContainersBatch` STAYS (rule 5) as the label-keyed shim.
      Regenerate registry/docs/mcp; `docs/api-coverage.md` reachability floor must not drop — if
      it does, the two retired ops need `agentAccess: "denied"` rows with a reason instead of
      deletion.
- [ ] `prepKitCategoryId` → `containerCategoryIds` migration of the org-settings blob (read-time
      merge, no backfill), then delete the old key.
- [ ] Rewrite FEATUREDOCS/32 as "Packing containers" (keep the number), update FEATUREDOCS/12's
      container sections, `ARCHITECTURE.md` table row, glossary entry for "Prep container" → alias
      of "Container", CLAUDE.md gets a short "containers" convention block (per-unit membership,
      never priced, `syncContainersBatch` is a shim).
- [ ] Delete the `\0container` grouping suffix comments and any dead `selectedContainer` code left
      in `page.tsx`.

**Acceptance:** `grep -rn prepContainer src convex` returns only the backfill module and its test;
schema-strictness deploy succeeds; every doc that mentioned the string field is updated.

---

## Phase 6 — Later (not scheduled)

- **Container labels** (Q14): A6/thermal label per container via react-pdf (job, label, tag, QR of
  the container id, count, "1 of n"), printed from the Prepped header or "Print all labels".
- **Bulk-tub picker** (D2): enable the `BULK_ASSET` kind in the New container sheet once tubs
  exist as a tagged bulk asset; the schema and roll-up already support it.
- **Client PO / order reference** on docket + manifest (Q11) — needs a field on `projects` first.

---

## Cross-cutting

**Per-PR gates (every phase):** `pnpm lint`, `npx tsc --noEmit`, `pnpm test`, `pnpm run
api:registry:check`, `scripts/xtenant-bycuid-ratchet.mjs`, `scripts/version-scope-ratchet.mjs`,
the PR-size advisory (split rather than justify — the phases above are already cut to it), and the
FEATUREDOC/CLAUDE.md update in the same PR (R-5.2/R-5.3).

**Convex discipline:** `pnpm exec convex`, never `npx`; no pushes to the shared dev deployment; the
backfill and any click-through run on a per-branch preview deployment; new modules are two hand
lines in `api.d.ts`; `throw new ConvexError`, never `Error`.

**Testing floor:** every new mutation has a convex-test file; every new overlay has a jsdom render
smoke test; every PDF shape change has a full-pipeline test; phase 0's repros are the regression
tests for the two defects that started this.

**Docs touched by the end:** FEATUREDOCS/12, /13, /32 (rewrite), /47 (drag helper), /56, /69 (new
tab), `docs/api-coverage.md` (regenerated), `docs/glossary.md`, `ARCHITECTURE.md`, `CLAUDE.md`,
`.claude/skills/rvlt-flow/SKILL.md`, `docs/ROADMAP.md` §1.4 follow-up line, `TODOS.md` (close the
delivery-docket kit special-case item).

**Risks carried from the design (§8), with the phase that owns each:** cross-tenant reads on the
new global indexes (1a, ratchet), version scoping (1a), reality carry-over of a deployed case (1c),
synthetic-row status (3a), `total_items` double-count (3a), Helvetica-only glyphs in the manifest
(3b), stable-contract refusal on `syncContainersBatch` (1c, 5).

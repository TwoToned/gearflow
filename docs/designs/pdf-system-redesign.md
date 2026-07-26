# PDF System Redesign — one reliable pipeline, simple global settings

> _Owner: Jayden Nawotka · Status: **PLANNED** · Created: 2026-07-26_
> _Branch: `claude/pdf-system-redesign-rogcv5` · Supersedes/expands: issue [#790](https://github.com/TwoToned/gearflow/issues/790)_
> _Prior art: `docs/designs/archive/pdf-template-builder.md`, `docs/designs/archive/block-editor-template-builder.md` (both built the system this doc removes)_

## Problem

The PDF customization system is bulky, mostly dead, and the part of it users actually
hit is broken:

1. **The builder UI is already gone** (`chore/remove-pdf-builder-and-dnd`), but the
   engine it drove was left behind: two parallel render pipelines, a 13-type section
   model with visibility conditions and `{token}` resolution, a block/layout-hint/
   block-styling data model, dormant `documentTemplates`/`brandTemplates`/
   `sectionPresets` Convex tables with service-only CRUD nothing calls, a dead
   template-preview API route, and a `TemplateSettings` deep-merge layer. That is
   **~4,700 LOC of source + ~3,600 LOC of tests (~8,300 total)** maintaining a
   feature no user can reach.
2. **Default documents silently truncate.** Since no `documentTemplates` row can be
   created anymore, `loadTemplate()` returns null for every org and `generatePdf()`
   falls through to the legacy hardcoded builders (`templates/quote.ts` etc.) —
   **single-page** templates. `gearflowTable` detects overflow and just stops drawing
   (`gearflow-table.ts:374` and friends). A quote longer than one page loses its tail.
   The multi-page pagination engine exists, but it lives in `section-renderer.ts`
   (1,485 LOC), which only runs for stored section templates that can no longer be
   created.
3. **The dual pipeline is the root footgun.** CLAUDE.md documents 5 independent
   consumers of the line-item shape and three separate user-impacting deploys
   (v0.8.1.0–v0.8.1.2) caused by them drifting. Two pipelines × per-template stored
   settings is why.

## Goals

- **One** render pipeline per project document. No template selection, no stored
  templates, no per-template settings.
- **Reliable pagination by default**: long equipment lists split across pages with
  repeated table headers, atomic rows, and no tail-drop — on every doc type.
- **Simple global settings only**: org-level branding (colour, logo, company details —
  already exists) plus a small "documents" settings group (footer text, terms &
  conditions, quote validity). Nothing per-template, nothing structural.
- Delete the customization engine and its persistence outright (~8,300 LOC).
- Land the #790 quote improvements **on top of the simplified system**, not the old one.

## Non-goals

- No template designer/builder of any kind, now or planned.
- No per-document or per-project layout overrides.
- T&T reports (`tt-*.ts`), the project **timeline** PDF, and the service-based
  **call sheet** (`call-sheet-services.ts`) keep their own simple hardcoded builders —
  they are already single-purpose and not part of the customization system. Only the
  dead `templateId` plumbing is removed from them.
- No change to the vendor boundary: `renderPdfTemplate()` in `pdf-render.ts` stays the
  only `@pdfme/generator` call site (R-8.10.1, enforced by ESLint).

## Current state (surveyed 2026-07-26)

- `src/lib/pdfme/`: 63 files, ~17,500 LOC (12,666 src / 4,834 test).
- Whole PDF system incl. routes, Convex CRUD, validations: **~19,900 LOC**.
- Customization-only layer: **~4,700 src + ~3,600 test LOC** (breakdown in Appendix A).
- Persistence: Prisma has **no** template models (already dropped). Convex still
  declares `brandTemplates`, `documentTemplates`, `sectionPresets`
  (`convex/schema.ts:1823–1874`) — all dormant, no write path exists in the app.
  `sectionPresets` has zero readers *or* writers outside its own CRUD file.
- Dead code confirmed: `block-utils.ts` (only its test imports it),
  `/api/documents/template-preview` (zero UI callers), `generatePdfFromData()`,
  `getDocumentTemplate(id)`, the template-picker submenu on the project page
  (`getPublishedTemplatesForDropdown()` always returns `[]`).
- Global branding already exists and is the model to build on: `OrgBranding`
  (`src/lib/org-settings-types.ts`) — `documentColor`, `logoUrl`/`iconUrl`,
  `documentLogoMode`, `showOrgNameOnDocuments` — stored in the `orgSettings` Convex
  blob, edited at `/settings/branding`, consumed by `build-document-data.ts`.

## Target architecture

```
API route (?type=quote|invoice|pull-slip|delivery-docket|return-sheet)
  └─ generatePdf(projectId, orgId, docType)           ── no templateId param
       ├─ buildDocumentData(...)                       ── unchanged (org branding, line
       │                                                  items via structureLineItems)
       ├─ DOCUMENT_LAYOUTS[docType]                    ── hardcoded fixed layout (plain TS)
       ├─ composeDocument(layout, data, branding)      ── slimmed flow/pagination core
       └─ renderPdfTemplate(template, inputs)          ── unchanged vendor boundary
```

**`document-layouts.ts` (new, small).** One plain-TS layout definition per doc type —
an ordered list of blocks (header, client/project details, table, totals, notes,
signature, custom text) with fixed per-doc options (which columns, checkboxes,
`expandProjectGroups`, status filter). This is today's `getDefaultSections()` content,
demoted from persisted-JSON-shaped config to code. There is exactly **one** definition
per doc type — no variants, no merge step (R-3.1: single source of truth).

**`document-composer.ts` (slimmed from `section-renderer.ts`).** Keep the parts that
make pagination work; delete the parts that made it customizable:

| Keep (the pagination core) | Delete (the customization engine) |
|---|---|
| Column-aware height estimation (`template-constants.ts`) | Visibility conditions (`condition-evaluator.ts`) |
| Atomic row page-breaks (never split mid-row) | `{token}` resolution (`token-resolver.ts`) |
| Table overflow → `startIndex` continuation on next page | Block model, `layoutHint` columns, `flattenBlocks` |
| Repeated table/page headers on continuation pages | Block styling / `gearflowRect` backgrounds |
| Overflow checks for totals/signature/notes/text blocks | Per-template `TemplateSettings` + `resolveTemplateSettings` merge |

Per-doc behaviour that used to come from settings (`expandProjectGroups`, packer sort,
status filters, checkbox/per-unit modes) becomes constants in the layout definition.
This eliminates the "two default sources must agree" trap documented in
FEATUREDOCS/13 §Constraints.

**The legacy builders for the 6 project doc types are deleted** (`quote.ts`,
`invoice.ts`, `packing-list.ts`, `return-sheet.ts`, `delivery-docket.ts`,
`call-sheet.ts`, plus `shared-builders.ts` and `template-settings.ts`). They are the
single-page truncation path. `templates/index.ts` shrinks to the T&T report registry.

**Consumer count drops.** The 5-consumer line-item-shape audit (CLAUDE.md) becomes 3
consumers in 2 files: gearflow-table rendering, composer height-calc, composer/plugin
status filter — with the plugin-level and section-level filters unified into one
place. The CLAUDE.md footgun section gets rewritten to match.

## Global document settings

All org-level, all in the existing `orgSettings` Convex blob (no new tables):

| Setting | Where | Notes |
|---|---|---|
| `documentColor`, `logoUrl`/`iconUrl`, `documentLogoMode`, `showOrgNameOnDocuments` | `branding` (exists) | unchanged |
| Company details (phone, email, address, `taxRate`, `taxLabel`) | exists | unchanged |
| `documents.footerText` / `documents.footerSecondLine` | **new** | replaces `BrandTemplate.footerSettings` |
| `documents.termsAndConditions` | **new** | free text, rendered as a block on quote (and optionally invoice); no token system — plain text |
| `documents.quoteValidityDays` | **new**, default 30 | expiry rendered as a real date: "Valid until {generatedAt + N days}" — replaces the hardcoded 30-day blurb (#790) |

Zod schema extends the existing org-settings validation; server-side bounds mirrored
per R-8.6.2 (string length caps, `quoteValidityDays` 1–365). UI: a "Documents" card on
`/settings/branding` (page title becomes "Branding & documents") — deliberately one
screen, a handful of fields.

Colour precedence simplifies from `brandTemplate.accentColor → org documentColor` to
just `org documentColor`.

## What gets deleted

**Files (source):** `section-renderer.ts`\*, `section-types.ts`\*, `block-utils.ts`,
`condition-evaluator.ts`, `token-resolver.ts`, `template-settings.ts`,
`sample-document-data.ts`, `plugins/gearflow-rect.ts`,
`templates/{quote,invoice,packing-list,return-sheet,delivery-docket,call-sheet}.ts`,
`templates/shared-builders.ts`, `src/lib/validations/template-section.ts`,
`src/lib/document-template-read.ts`, `src/lib/brand-templates-read.ts`,
`src/server/document-templates.ts`, `convex/documentTemplates.ts`,
`convex/brandTemplates.ts`, `convex/sectionPresets.ts`,
`src/app/api/documents/template-preview/route.tsx`,
`src/app/(app)/settings/documents/page.tsx` (+ its nav entry).
\* replaced by the slimmed `document-composer.ts` / `document-layouts.ts` — expect the
composer to keep a fraction of section-renderer's 1,485 lines.

**Inside surviving files:** `generate-pdf.ts` drops `loadTemplate`,
`expandSectionsForDates`, `generatePdfFromSections/FromSettings/FromData` and the
`templateId` param (~250 of 368 lines); the two document API routes drop `templateId`;
`templates/call-sheet-services.ts` drops its ignored `templateId` option;
`projects/[id]/page.tsx` drops the template submenu + `getPublishedTemplatesForDropdown`
query; `src/lib/validations/document-template.ts` reduces to `DOCUMENT_TYPES` +
`DOCUMENT_TYPE_LABELS` (relocated next to `types.ts`).

**Convex schema:** remove the `brandTemplates`, `documentTemplates`, `sectionPresets`
table declarations (**hand-edit** `convex/schema.ts` per the CLAUDE.md warning — never
regenerate). Any dormant rows in the prod deployment become orphaned; clear them from
the dashboard (or a one-off script) after the schema push. **Check prod for rows
before Phase 2** — if any org still renders via a stored section template, losing it
is *intended* (that's the rip-out), but we should know it's happening.

**Tests:** the ~3,600 LOC covering the deleted layer (`section-renderer.test.ts`,
`template-section.test.ts`, `block-utils.test.ts`, `document-template-read.test.ts`,
`condition-evaluator.test.ts`, `expand-sections.test.ts`, `token-resolver.test.ts`,
`brand-templates-read.test.ts`, `template-settings.test.ts`, part of
`document-template.test.ts`). Pagination-relevant cases from
`section-renderer.test.ts` are **ported to the composer's test suite**, not dropped.

**Docs/config:** `docs/exceptions.md` rows for `documentTemplates.list` /
`sectionPresets.list` collect exemptions; FEATUREDOCS/03 (schema) template tables;
ARCHITECTURE.md links; the dormant-data-model sections of FEATUREDOCS/13.

## What stays untouched

`pdf-render.ts` (vendor boundary + ESLint pin), `fonts.ts`, all plugins except
`gearflow-rect` (incl. `gearflow-table.ts`, `gearflow-financial-summary.ts`,
crew/call-sheet/data-table/summary/text-block plugins), `build-document-data.ts`,
`structure-line-items.ts`, `template-constants.ts`, `types.ts`, the T&T report
builders + route, `timeline.ts` + route, `call-sheet-services.ts` (minus templateId),
org branding settings + `/settings/branding`, all four `@pdfme/*` deps.

## Phased implementation

Each phase is a PR-sized unit; FEATUREDOCS/13 + CLAUDE.md updates ride in the same PR
as the change they describe (R-5.2/R-5.3).

### Phase 0 — Safety net
Integration tests through the real pipeline (`structureLineItems` →
`buildDocumentData`-shaped fixtures → render) for all 5 project doc types, including a
**long fixture** (multi-page) asserting *every* line item appears in the rendered
inputs across pages (no tail-drop), group/kit/accessory rows included. These are the
regression harness for the swap and stay forever. (The plugin-only harness in
`plugins/test-utils.ts` is explicitly not enough — CLAUDE.md test-coverage rule.)

### Phase 1 — One pipeline
1. Add `document-layouts.ts` (fixed layouts ≈ today's `getDefaultSections()` output)
   and `document-composer.ts` (slimmed from `section-renderer.ts` per the keep/delete
   table above).
2. `generatePdf()` becomes: build data → compose → render. Remove `loadTemplate`,
   settings resolution, `templateId`.
3. Routes + UI: drop `templateId` params and the always-empty template submenu.
4. Delete the 6 legacy builders + `shared-builders.ts` + `template-settings.ts`;
   `structure-line-items.ts` reads `expandProjectGroups`/packer-sort from the layout
   constants.
5. **Outcome check:** Phase 0 suite green — this is the PR that fixes silent
   truncation on long default documents.

### Phase 2 — Delete the customization layer
Everything in "What gets deleted" not already gone in Phase 1: engine files, Convex
CRUD + schema declarations (hand-edited, then `pnpm exec convex dev --once`), read
wrappers, validations, preview route, settings/documents page, dead tests,
exceptions.md rows. Prod dormant-row check + cleanup.

### Phase 3 — Global document settings
`documents.{footerText, footerSecondLine, termsAndConditions, quoteValidityDays}` in
the org-settings blob: Zod + server-side mirror (R-8.6.2), "Documents" card on the
branding page, composer wiring (footer on all docs; T&Cs + validity on quote).

### Phase 4 — #790 quote improvements (on the simplified system)
- [ ] Remove the "/day" suffix on the **quote** layout (`PER_DAY` in
      `gearflow-table.ts:45`) — layout-level flag, other doc types unchanged.
- [ ] Discounts: audit end-to-end that `discountAmount` surfaces on the quote totals
      block; fix if silently dropped.
- [ ] Item notes **and** group notes/descriptions render on the quote.
- [ ] Terms & conditions block (from Phase 3 setting) on the quote.
- [ ] Quote expiry as a real computed date (Phase 3 `quoteValidityDays`), replacing
      the static 30-day blurb.
- [ ] Crewing/services section on the quote: billable `Project Services` /
      `CrewAssignment` (`billableToClient`) rows, reusing the existing
      crew-table/data-table plugins.
- [ ] General tidiness pass on the quote layout per DESIGN.md (spacing/hierarchy).

### Phase 5 — Docs close-out
Full FEATUREDOCS/13 rewrite (single pipeline, fixed layouts, global settings);
CLAUDE.md "PDF generation" footgun section rewritten for the reduced consumer count;
ARCHITECTURE.md; CHANGELOG.

## Testing strategy

- Phase 0 integration suite is the backbone: full-pipeline, long fixtures, per doc
  type, tail-drop assertions.
- Keep: `structure-line-items.test.ts`, plugin render tests
  (`gearflow-table.test.ts`, `accessories-render.test.ts`, `get-asset-tag.test.ts`),
  `line-item-tree-attach`, `document-data-reconstruction`, `rebrand-plugin-aliases`.
- Port pagination cases from `section-renderer.test.ts` into the composer suite.
- New unit tests: layout constants sanity (every doc type has a layout; filters match
  the deployment-aware rules in FEATUREDOCS/13), settings Zod bounds, validity-date
  computation.

## Risks

| Risk | Mitigation |
|---|---|
| Composer slim-down breaks a pagination invariant (the v0.8.1.x class of bug) | Phase 0 harness lands *before* any engine change; port section-renderer's pagination tests |
| A prod org still renders via a dormant stored template and its output changes | Pre-Phase-2 prod row check; change is intended (rip-out) but announced, not discovered |
| Visual diffs on default docs (fixed layouts ≈ section defaults ≠ legacy single-page layout) | Accepted — the legacy path truncates; parity target is the section-default look, reviewed against DESIGN.md in Phase 4 |
| `structure-line-items` option plumbing regressions when settings→constants | Existing 1,162-line test file + Phase 0 suite |
| Convex table removal with rows present | Rows checked/cleared first; removal is schema-declaration only, reversible until data cleared |

## Acceptance criteria

- [ ] Exactly one render pipeline for project documents; `loadTemplate`, dual
      dispatch, `templateId`, and stored templates are gone.
- [ ] A 100+ line project renders every item across multiple pages on every doc type
      (no silent tail-drop), with repeated headers.
- [ ] `documentTemplates`, `brandTemplates`, `sectionPresets` tables, CRUD, and all
      section/block/token/condition/settings machinery deleted (~8,300 LOC net).
- [ ] Org settings expose only: branding (existing) + footer text, T&Cs, quote
      validity days.
- [ ] All #790 acceptance criteria met on the new pipeline.
- [ ] FEATUREDOCS/13, CLAUDE.md PDF section, ARCHITECTURE.md, exceptions.md updated.

## Appendix A — customization-layer LOC (source, pre-deletion)

```
section-renderer.ts             1485    convex/documentTemplates.ts      130
section-types.ts                 595    condition-evaluator.ts           117
validations/template-section.ts  383    convex/brandTemplates.ts         106
template-settings.ts             323    convex/sectionPresets.ts         100
block-utils.ts                   290    api/.../template-preview          66
token-resolver.ts                242    settings/documents/page.tsx       74
sample-document-data.ts          230    plugins/gearflow-rect.ts          65
document-template-read.ts        174    validations/document-template.ts  36 (partial)
server/document-templates.ts     159    generate-pdf.ts                 ~250 (partial)
brand-templates-read.ts          132
                                        ≈ 4,700 src + ≈ 3,600 test
```

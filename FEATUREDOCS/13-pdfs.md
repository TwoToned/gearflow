# PDF Document Generation

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Architecture

All PDF generation uses **pdfme** (`@pdfme/generator` + `@pdfme/common` + custom plugins via `@pdfme/pdf-lib`).

### Generation Pipeline — Two Pipelines

**1. Section-Based Pipeline (new, preferred)**
1. Template has `sections` field → array of `TemplateSection` objects
2. `renderSections()` evaluates visibility → computes page layout → builds pdfme `Template` + `inputs`
3. Multi-page pagination: section heights estimated → tables split across pages → headers repeated on continuation pages
4. pdfme `generate()` renders → PDF `Uint8Array`

**Pagination engine features:**
- Column-aware height estimation using shared constants + `layoutHint` width scaling
- Row-level page breaks (atomic rows, never split mid-row) via `layoutHint.rowId` grouping
- Table/crew-table overflow detection with `startIndex` continuation on next page
- All sections check overflow (signature, totals, custom text, notes, payment details)
- Block styling (backgrounds, borders via `gearflowRect` plugin) re-drawn on continuation pages
- Header continuation on overflow pages

**2. Legacy Pipeline (fallback)**
1. Template has `basePdf` + `schemas` fields → direct pdfme template
2. `getTemplateBuilder(docType)` → hardcoded template builder
3. pdfme `generate()` renders → PDF `Uint8Array`

**Template selection**: `templateId` → org's default published template → system default. Section-based templates are preferred when available.

### Vendor Boundary
`@pdfme/generator`'s `generate()` has exactly one call site: `renderPdfTemplate()` in
`src/lib/pdfme/pdf-render.ts` (POLICY.md R-8.10.1). It lives in its own module rather
than in `generate-pdf.ts` because `generate-pdf.ts` dynamically imports
`templates/call-sheet-services.ts` — if that file imported `renderPdfTemplate` back
from `generate-pdf.ts` the two would form a circular dependency (caught by the
`depcruise-ratchet` CI check). Every generation path — the legacy/section pipelines
in `generate-pdf.ts`, `templates/call-sheet-services.ts`, and
`/api/documents/timeline/[projectId]/route.tsx` — calls `renderPdfTemplate()` instead
of importing `@pdfme/generator` directly. `no-restricted-imports` in
`eslint.config.mjs` blocks direct imports of `@pdfme/generator` everywhere except
`pdf-render.ts` to keep it that way.

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/pdfme/generate-pdf.ts` | Orchestrator — dual pipeline, `loadTemplate()` with brand resolution |
| `src/lib/pdfme/pdf-render.ts` | `renderPdfTemplate()` — the single `@pdfme/generator` call site |
| `src/lib/pdfme/section-renderer.ts` | Section-based renderer — converts `TemplateSection[]` → multi-page pdfme `Template` + `inputs` |
| `src/lib/pdfme/section-types.ts` | Section type definitions, default settings, default section lists per doc type |
| `src/lib/pdfme/condition-evaluator.ts` | Visibility condition evaluation (doc type filter + data conditions) |
| `src/lib/pdfme/token-resolver.ts` | `{token}` resolution with whitelist, `resolveTokensInText()`, `getAllowedTokens()` |
| `src/lib/pdfme/build-document-data.ts` | Assembles `DocumentData` contract for project documents. Loads project + sub-hires + categories with location data. Calls `structureLineItems` |
| `src/lib/pdfme/structure-line-items.ts` | Pure helper — restructures raw line items into per-bucket arrays for the table plugin. Handles Project Group expand/collapse, sub-hire sections, kit boundary, packer-walk sort |
| `src/lib/pdfme/templates/index.ts` | Template registry — maps doc types → template builders (legacy) |
| `src/lib/pdfme/templates/shared-builders.ts` | Shared helpers mapping `TemplateSettings` → plugin configs (legacy) |
| `src/lib/pdfme/template-settings.ts` | `TemplateSettings` interface, `getDefaultSettings()` per doc type, `resolveTemplateSettings()` for legacy-JSON merge |
| `src/lib/pdfme/sample-document-data.ts` | Sample data generator for preview (real org branding + fake content) |
| `src/lib/pdfme/types.ts` | `DocumentType`, `TestTagReportType`, `DocumentData`, plugin config types |
| `src/lib/pdfme/plugins/index.ts` | Plugin registry — all custom + built-in plugins |
| `src/lib/pdfme/fonts.ts` | Font configuration for pdfme |
| `src/lib/pdfme/block-utils.ts` | Block ↔ section converters (`flattenBlocks`, `sectionsToBlocks`) |
| `src/lib/pdfme/template-constants.ts` | Shared height/dimension constants (row heights, padding, font sizes, page dimensions) |
| `src/lib/validations/template-section.ts` | Zod schemas for sections (discriminated union), blocks, brand templates, export/import |

### Custom Plugins (`src/lib/pdfme/plugins/`)

**Project Document Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowTable` | Equipment table — grouping (by `groupName` or `prepContainer`), kit children (3 levels), badges, checkboxes, conditions, per-unit expansion. Container line items (`isContainerLineItem`) are excluded. |
| `gearflowFinancialSummary` | Subtotal/discount/tax/total block with optional deposit/balance |
| `gearflowPageHeader` | Three modes: logo, icon, none — org info + doc title |
| `gearflowPageFooter` | Centered footer with top border |
| `gearflowCheckbox` | Empty/checked checkbox square |
| `gearflowSignatureLine` | Signature blocks with configurable columns |
| `gearflowCrewTable` | Crew table for call sheets — sorted by call time then role |
| `gearflowCallSheetInfo` | 2-column info block: PM/client/equipment (left), venue/schedule (right) |
| `gearflowDayHeader` | Day separator with accent bar, date label, phase badges, crew count |

**Report Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowDataTable` | Generic configurable table with columns, sections, badges, expanded notes |
| `gearflowSummaryBox` | Horizontal metrics row (e.g., "Total: 42", "Compliance: 95%") |
| `gearflowTextBlock` | Multi-line text — paragraphs, key-value grids, section titles |

| `gearflowRect` | Background rectangles + borders behind content sections (block styling) |

### Plugin Architecture
- Plugins receive `value` as JSON string, parse it, draw directly via pdf-lib
- `helpers.ts`: coordinate conversion (mm→pt, Y-flip), font caching (Helvetica/Bold/Courier), color parsing, text wrapping, formatCurrency/formatDate
- `ui` and `propPanel` are stubs (template designer visual polish is a future phase)

## Section-Based Templates

> **Builder UI removed (chore/remove-pdf-builder-and-dnd).** The interactive
> PDF template designer/builder (the `(designer)` route, `BlockEditor`,
> `SectionBuilder`, `TemplateEditor`, `DocumentDesigner`,
> `DocumentTemplateManager`, and all builder/write server actions) has been
> deleted. **PDF generation itself is unchanged** — the generator pipeline
> (`src/lib/pdfme/*`, `@pdfme/common|generator|pdf-lib|schemas`) and the
> built-in/system-default templates remain. The `DocumentTemplate` /
> `SectionPreset` Prisma + Convex tables are left **dormant** (no migration).
> The section/block data model below documents that dormant persisted shape;
> it is no longer editable in-app. `/settings/documents` is now a read-only
> view listing each document type and its built-in default. Read functions
> kept in `src/server/document-templates.ts`: `getDocumentTemplates`,
> `getPublishedTemplatesForDropdown`, `getDocumentTemplate`. `@pdfme/ui`
> dependency removed.

### Section Types (11 types)
| Type | Description | Settings |
|------|-------------|----------|
| `header` | Org logo, name, document title | logo mode, show org fields, title text |
| `client-details` | Client info block | show name/contact/email/address/tax ID |
| `project-details` | Project info block | show name/number/venue/dates/terms |
| `table` | Equipment line items | group headers, pricing, checkboxes, badges, notes, asset tags |
| `totals` | Financial summary | subtotal/discount/tax/total/deposit/balance toggles |
| `notes` | Client/crew notes | show client notes, show crew notes |
| `signature` | Signature lines | 1-6 columns with custom labels |
| `custom-text` | Free text with tokens | font size, weight, alignment + `{token}` support |
| `crew-table` | Crew assignments | show phone/email/notes |
| `call-sheet-info` | PM, venue, schedule, equipment | show PM/client/venue/schedule/equipment |
| `day-header` | Day separator for multi-day sheets | show phases, show crew count |
| `spacer` | Vertical spacing | height in mm (2-100) |
| `page-break` | Force page break | no settings |

### Visibility System
- **Document type filter**: Show section only for specific doc types (e.g., totals only on quotes/invoices)
- **Data conditions**: Show/hide based on data field values (exists, not_exists, equals, not_equals)
- **Whitelist**: Only allowed DocumentData fields can be referenced in conditions (security)

### Token System
- `{client_name}`, `{project_name}`, `{total}` etc. in custom-text sections
- Whitelist-validated — unknown tokens resolve to empty string
- Case-insensitive matching
- `getAllowedTokens()` returns categorized list for UI autocomplete

### Brand Templates
- **Model**: `BrandTemplate` — org-level header/footer/color inheritance
- **Fields**: `headerSettings` (JSON), `footerSettings` (JSON), `accentColor`
- **Inheritance**: Document templates link to a brand template via `brandTemplateId`
- **Convex functions**: `convex/brandTemplates.ts` — `list`/`getById` (reads) + `create`/`createIfMissing`/`update`/`remove` (mutations, includes set/unset default). Formerly `src/server/brand-templates.ts`, now deleted.

### Block / Section Data Model (dormant)

The former block editor persisted a flat `TemplateSection[]` with `layoutHint`
metadata (the block tree was an editor-only concept). The editor UI is gone,
but this persisted shape still drives the generator's `flattenBlocks()` /
`section-renderer` path, so the data model is documented here.

#### Data Model
- **`TemplateBlock`**: `{ id, type: 'row'|'column'|content, children?, settings?, visibility?, content?, columnWidths?, styling? }`
- **`LayoutHint`**: `{ rowId, columnIndex, columnWidth, columnCount }` — added to `TemplateSection` for column positioning
- **`BlockStyling`**: `{ backgroundColor?, borderColor?, borderWidth?, padding?, margin? }` — per-section PDF styling
- **Lazy migration**: Old flat sections auto-wrapped into blocks on load via `sectionsToBlocks()`
- **Constraints**: max 4 columns per row, max 2 levels deep, column widths sum to 100%

#### Key Files
| File | Purpose |
|------|---------|
| `src/lib/pdfme/block-utils.ts` | `flattenBlocks()`, `sectionsToBlocks()` — block ↔ section conversion |
| `src/lib/pdfme/template-constants.ts` | Shared height/dimension constants for plugins + estimator |
| `src/lib/pdfme/plugins/gearflow-rect.ts` | Background rectangles + borders for block styling in PDF |
| `src/lib/validations/template-section.ts` | Discriminated union Zod validation for all section types |

> The interactive editor UI (`BlockEditor`, `BlockTree`, `BlockCard`,
> `ColumnWidthPicker`, `HtmlPreview`, `SectionSettingsPanel`,
> `SectionLibrary`, `SectionBuilder`, `SectionCard`, `TemplateEditor`) and
> the `/template-designer/[id]` route were **deleted**. The block/section
> persisted shape and the `flattenBlocks()` / `section-renderer` generator
> path remain. All builder write server actions (`saveTemplateSections`,
> `saveTemplateBlocks`, `exportTemplate`, `importTemplate`,
> `duplicateSystemDefault*`, `saveTemplateThumbnail`,
> `create/update/publish/setDefault/unsetDefault/deleteDocumentTemplate`,
> `duplicateDocumentTemplate`, `saveTemplateSettings`, `getTemplateForEditor`)
> were removed.

### Template Management (read-only)
- **Settings page**: `/settings/documents` — a thin read-only list of each
  document type and its built-in (system-default) template name. No
  create/edit/duplicate/delete/builder affordances.
- **System defaults**: Virtual entries from `getDefaultSections()` /
  `getTemplateBuilder()`, surfaced via `getDocumentTemplates()`.
- **Read server actions** (`src/server/document-templates.ts`):
  `getDocumentTemplates`, `getPublishedTemplatesForDropdown`,
  `getDocumentTemplate`.

### Database Models

**BrandTemplate** (`brand_template`):
- `id`, `organizationId`, `name`, `headerSettings` (JSON), `footerSettings` (JSON), `accentColor`, `isDefault`

**DocumentTemplate** (`document_template`):
- Legacy: `basePdf` (JSON, nullable), `schemas` (JSON, nullable), `settings` (JSON, nullable)
- Section-based: `sections` (JSON, nullable — `TemplateSection[]`), `brandTemplateId`, `thumbnailData`
- Common: `name`, `type`, `isDefault`, `isDraft`, `version`, `thumbnailUrl`, `publishedAt`

## Project Document Templates

6 document types with system defaults in `src/lib/pdfme/templates/` (legacy) and `getDefaultSections()` (section-based):

| Type | Default Sections |
|------|-----------------|
| `quote` | header, client-details, project-details, table, totals, notes, custom-text (30-day validity) |
| `invoice` | header, client-details (+ tax ID), project-details (+ terms), table, totals (+ deposit/balance), notes |
| `packing-list` | header, client-details, project-details, table (checkboxes, per-unit, asset tags), custom-text (total items) |
| `return-sheet` | header, client-details, project-details, table (checkboxes, conditions, asset tags), signature (3 cols) |
| `delivery-docket` | header, client-details, project-details (+ site contact), table (checkboxes, row numbers, per-unit, asset tags), signature (3 cols) |
| `call-sheet` | header, call-sheet-info, crew-table, notes (crew only) |

### Template Picker
- Project detail page documents dropdown queries for published custom templates
- If custom templates exist for a doc type, shows sub-menu: "Default" + each custom template
- If no customs, generates with default (org custom default or system default)

## Child Rendering (Kits, Prep-Kits, Accessories)
All document templates use a unified line item hierarchy with up to 3 levels:
- **Level 1**: Regular items and kit parents (group headers)
- **Level 2**: Kit children, indented sub-rows
- **Level 3**: Nested kit children (kits inside prep-kits), deeper indent

### Asset Tag Display on PDFs
- Regular kits/assets: show their asset tag
- Prep-kits with `PREP-*` auto-generated tags: display `"-"` instead
- Prep-kits with case asset tags: show the real tag

## Deployment-Aware Filtering
- **Delivery Docket**: Filtered to `CHECKED_OUT` status only at all levels
- **Return Sheet**: Filtered to `CHECKED_OUT` or `RETURNED` at all levels
- **Pull Slip**: All non-cancelled items. Already-deployed items show ticked checkbox
- **Quote / Invoice**: All items shown regardless of deployment status

## T&T Reports

10 report types generated via pdfme, each with a template builder in `src/lib/pdfme/templates/tt-*.ts`. API route: `GET /api/test-tag-reports/[reportType]?format=pdf|csv`. CSV export is unchanged.

| Report | Template | Orientation | Key Plugins |
|--------|----------|-------------|-------------|
| Full Register | `tt-register.ts` | Landscape | header, summaryBox, dataTable, footer |
| Overdue/Non-Compliant | `tt-overdue.ts` | Portrait | header, dataTable (3 sections), signatureLine, footer |
| Test Session | `tt-session.ts` | Landscape | header, summaryBox, dataTable (result badges), signatureLine, footer |
| Item History | `tt-item-history.ts` | Portrait | header, textBlock (key-value details), dataTable, footer |
| Due Schedule | `tt-due-schedule.ts` | Landscape | header, dataTable (2 sections), footer |
| Class Summary | `tt-class-summary.ts` | Landscape | header, dataTable (grouped sections), footer |
| Tester Activity | `tt-tester-activity.ts` | Portrait | header, dataTable (sections per tester), footer |
| Failed Items | `tt-failed-items.ts` | Landscape | header, summaryBox, dataTable, footer |
| Bulk Asset Summary | `tt-bulk-summary.ts` | Portrait | header, textBlock, summaryBox, dataTable, footer |
| Compliance Certificate | `tt-compliance-cert.ts` | Portrait | header, textBlock (legal), dataTable, textBlock (disclaimer), signatureLine, footer |

### Report Data Flow
1. API route calls server action (e.g., `getRegisterReportData(filters)`) → serialized report data
2. `getOrgData(organizationId)` → org branding, logo/icon as base64
3. `generateTestTagReport(reportType, reportData, orgData)` → pdfme generation

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/documents/template-preview` | POST | Generate template preview PDF. Body: `{ docType, sections }` or `{ docType, settings }`. Returns binary PDF |
| `/api/documents/[projectId]` | GET | Generate project document. Params: `type` (quote/invoice/pull-slip/delivery-docket/return-sheet), `templateId` (optional) |
| `/api/documents/call-sheet/[projectId]` | GET | Generate call sheet. Params: `date`, `dates` (comma-separated), `allDates=true`, `crewMemberId`, `templateId` (all optional). Multi-day/per-person params trigger `generateCallSheetPdf()` with section expansion. |
| `/api/test-tag-reports/[reportType]` | GET | Generate T&T report. Params: `format` (pdf/csv), filters (dateFrom, dateTo, status, equipmentClass, etc.) |

## Line item structuring

`structureLineItems(rawItems, categories, options, subHireGroups)` is the
pure helper that decides how rows bucket on the PDF. It runs once per
document inside `buildDocumentData`. Both render pipelines (legacy and
section-based) consume the resulting `data.line_items` array.

Two modes selected by `options.expandProjectGroups`:

- **collapse** (default for `quote`, `invoice`): each Project Group
  collapses into one synthetic `isGroupRow: true` row. Children dropped
  so the client sees "Lighting Package x1 @ $5000" rather than every
  itemised lamp. Sub-hire items stay inside their target category so
  category subtotals roll up correctly.
- **expand** (default for `packing-list`, `return-sheet`,
  `delivery-docket`): each Project Group emits a synthetic
  `isGroupRow: true` row bucketed under its **category** (not its own
  section), with its non-kit members attached as `childLineItems`. The
  table plugin renders the group row bold (kit-style) and indents its
  members underneath — so "Drum Kit Mic Set" appears as a bold
  sub-header inside the "Band" category section, not as its own
  top-level section. Kit parents that lived inside the group still
  break out into their own `[Kit] <name>` section per the kit-boundary
  rule below. Warehouse staff still see every serial number, organised
  by category → group → item.

Three additional behaviours layer onto expand mode:

- **Sub-hire as own section**: items with a `subHireGroupId` matching
  any loaded sub-hire group get pulled out of their target category
  into a `Sub-Hire: <Supplier> — <Group Title>` section at the bottom
  of the doc. Owned gear renders first, hired-in second.
- **Kit boundary wins**: a kit parent (item with `kitId && !isKitChild`)
  emits with `groupName: "[Kit] <kit.name>"` regardless of which
  Project Group or Category it would otherwise belong to. Kit
  children render via the parent's `childLineItems[]` in the table
  plugin.
- **Packer-walk sort**: items within each bucket sort by `locationName`
  then `categoryName` then `model.name`. Null locations go to the
  bottom of each bucket via a sentinel character. Sort is controlled
  by `options.packerSort`, currently tied to `expandProjectGroups`
  (every expand-mode doc also wants packer order).

## Settings resolution

`resolveTemplateSettings(docType, stored)` deep-merges a stored
`DocumentTemplate.settings` JSON against the docType defaults so new
keys (added in later releases) pick up safe values automatically. Run
this once at the top of `generatePdf` before either pipeline starts —
the data builder reads `settings.table.expandProjectGroups` to decide
how to structure line items, and legacy stored JSON predates that key.
Without the merge, every existing template silently regresses to
collapsed-row output on the first deploy.

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state uses rotated lines
- Line item notes shown as subtitles
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units
- Per-unit rows (`showPerUnitCheckboxes`): a qty > 1 line expands to one row per assigned unit ("Unit 1 — TTP00042", …) instead of collapsing tags to "tag, tag +N". Default-on for `packing-list`, `return-sheet`, and `delivery-docket`. Two default sources must agree: `getDefaultSettings()` (legacy blob) **and** `getDefaultSections()` (section path — the active render path via `generate-pdf` `loadTemplate`). Templates customised before this was set on the section path keep the old single-row blob; the one-time migration script that flipped both settings to `true` org-wide (`scripts/migrate-docket-per-unit.ts` / `npm run migrate:docket-per-unit`) has since been deleted as completed one-off migration infra — any template still on the old blob today needs a manual settings fix, not a script run.

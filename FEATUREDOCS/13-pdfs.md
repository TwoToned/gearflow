# PDF Document Generation

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-27 (review quarterly — POLICY.md R-5.5)_

## Architecture

All PDF generation uses **pdfme** (`@pdfme/generator` + `@pdfme/common` + custom plugins via `@pdfme/pdf-lib`).

### Generation Pipeline — One Pipeline

Per the PDF system redesign (`docs/designs/pdf-system-redesign.md`, #790), the
customization engine (stored templates, sections, brand templates, block
editor) was ripped out. There is now **exactly one** render pipeline for the
5 project document types (quote, invoice, packing-list, return-sheet,
delivery-docket):

1. `buildDocumentData(projectId, organizationId, docType, ..., { expandProjectGroups })`
   assembles the `DocumentData` contract (org branding, project/client fields,
   line items via `structureLineItems`).
2. `DOCUMENT_LAYOUTS[docType]` (`document-layouts.ts`) — a **hardcoded, fixed**
   layout per doc type: an ordered list of blocks (header, client/project
   details, table, totals, notes, signature) with fixed options (which
   columns, checkboxes, status filter, `expandProjectGroups`). One definition
   per doc type — no variants, no stored overrides, no merge step.
3. `composeDocument(docType, data, docColor)` (`document-composer.ts`) — a
   purpose-built linear pagination engine. Walks the layout's blocks
   top-to-bottom, measures each against remaining page height using the
   shared constants in `template-constants.ts`, and starts a new page when a
   block doesn't fit. Table blocks split across pages via the plugin's
   `startIndex`/`endIndex`/`startSubIndex` support instead of moving whole —
   this is what fixes the pre-redesign truncation bug (long equipment lists
   used to render single-page only, silently dropping the tail).
4. `renderPdfTemplate(template, inputs)` — pdfme `generate()`, unchanged.

**Pagination invariants** (each covered by `document-composer.test.ts`):
- Atomic table rows — a row (incl. kit/group/accessory children) is never
  split mid-row; only complete per-unit sub-rows may continue on the next page.
- Table overflow continues on the next page (no silent tail-drop).
- Header repeats on every continuation page; footer on every page.
- Totals/signature/notes blocks are kept whole (pushed to the next page if
  they don't fit, never split).
- Every page's footer carries "Page X of Y" (omitted on single-page
  documents) — `pageNumber` is computed once in `composeDocument` per page
  index against the final page count and rendered right-aligned by
  `gearflowPageFooter`.

**Quote/invoice table simplification (2026-07-26):** the quote/invoice table
dropped its separate "Days" column — it duplicated the per-line `duration`
value next to the rate/total columns without adding information the reader
needed, and produced confusing/misleading output on lines whose duration
didn't match the project's overall rental span. `duration` is still a real
per-line DB field (`project-line-item-read.ts`); it's just no longer
rendered as its own column. `getAssetTag()` (`gearflow-table.ts`) also
dedupes unit tags before applying the "+N more" truncation — a bulk line's
units all share one `bulkAsset` tag, so without dedup a 10-unit bulk line
rendered as `"TTP00099, TTP00099 +8"` instead of the single tag.

Call sheets don't go through this pipeline — they use their own service-based
builder (`templates/call-sheet-services.ts`, queries `ProjectService`/
`CrewAssignment` directly). T&T reports and the project timeline keep their
own single-purpose builders (see below) — they were never part of the
customization system.

### Vendor Boundary
`@pdfme/generator`'s `generate()` has exactly one call site: `renderPdfTemplate()` in
`src/lib/pdfme/pdf-render.ts` (POLICY.md R-8.10.1). It lives in its own module rather
than in `generate-pdf.ts` because `generate-pdf.ts` dynamically imports
`templates/call-sheet-services.ts` — if that file imported `renderPdfTemplate` back
from `generate-pdf.ts` the two would form a circular dependency (caught by the
`depcruise-ratchet` CI check). Every generation path — `generate-pdf.ts`,
`templates/call-sheet-services.ts`, and
`/api/documents/timeline/[projectId]/route.tsx` — calls `renderPdfTemplate()` instead
of importing `@pdfme/generator` directly. `no-restricted-imports` in
`eslint.config.mjs` blocks direct imports of `@pdfme/generator` everywhere except
`pdf-render.ts` to keep it that way.

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/pdfme/generate-pdf.ts` | Orchestrator — build data → compose → render. `generateCallSheetPdf()` and `generateTestTagReport()` for the two doc families that keep their own builders. |
| `src/lib/pdfme/document-layouts.ts` | Fixed layout definitions (`DOCUMENT_LAYOUTS`) for the 5 project doc types — blocks, `expandProjectGroups`, status filter. Single source of truth. |
| `src/lib/pdfme/document-composer.ts` | Net-new pagination engine — `composeDocument()` walks a layout's blocks, measures against remaining page height, splits table blocks across pages. |
| `src/lib/pdfme/document-composer.test.ts` | Full-pipeline integration tests (Phase 0 safety net) — every doc type, a 120+ item fixture, asserts full parent-item index coverage across pages (no tail-drop). |
| `src/lib/pdfme/pdf-render.ts` | `renderPdfTemplate()` — the single `@pdfme/generator` call site |
| `src/lib/pdfme/build-document-data.ts` | Assembles `DocumentData` contract for project documents. Loads project + sub-hires + categories with location data. Calls `structureLineItems`. `client_contact`/`client_email`/`client_phone` resolve through a fallback chain (WS9 #948, [FEATUREDOCS/63](./63-client-contacts.md)): the project's explicitly selected `clientContactId` → the client's primary contact → the legacy embedded `clients.contactName/Email/Phone` fields. |
| `src/lib/pdfme/structure-line-items.ts` | Pure helper — restructures raw line items into per-bucket arrays for the table plugin. Handles Project Group expand/collapse, sub-hire sections, kit boundary, packer-walk sort |
| `src/lib/pdfme/templates/index.ts` | T&T report template registry only — maps `TestTagReportType` → builder |
| `src/lib/pdfme/templates/call-sheet-services.ts` | Service-based call sheet builder (queries `ProjectService`/`CrewAssignment` directly) |
| `src/lib/pdfme/templates/timeline.ts` | Project timeline builder |
| `src/lib/pdfme/templates/tt-*.ts` | The 10 T&T report builders |
| `src/lib/pdfme/types.ts` | `DocumentType`, `TestTagReportType`, `DocumentData`, plugin config types |
| `src/lib/pdfme/plugins/index.ts` | Plugin registry — all custom + built-in plugins |
| `src/lib/pdfme/fonts.ts` | Font configuration for pdfme |
| `src/lib/pdfme/template-constants.ts` | Shared height/dimension constants (row heights, padding, font sizes, page dimensions) — the composer's single source of truth for pagination math |

### Custom Plugins (`src/lib/pdfme/plugins/`)

**Project Document Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowTable` | Equipment table — grouping (by `groupName` or `prepContainer`), kit children (3 levels), badges, checkboxes, conditions, per-unit expansion. Container line items (`isContainerLineItem`) are excluded. Draws the derived billing-weeks/days breakdown under an auto-priced line's description when `showPricing` is on (#943 — see below). |
| `gearflowFinancialSummary` | Subtotal/discount/tax/total block with optional deposit/balance |
| `gearflowPageHeader` | Three modes: logo, icon, none — org info + doc title |
| `gearflowPageFooter` | Centered footer with top border; right-aligned "Page X of Y" when the document has more than one page (`FooterConfig.pageNumber`, computed per-page in `composeDocument`) |
| `gearflowCheckbox` | Empty/checked checkbox square |
| `gearflowSignatureLine` | Signature blocks with configurable columns |
| `gearflowCrewTable` | Crew table for call sheets — sorted by call time then role |
| `gearflowCallSheetInfo` | 2-column info block: PM/client/equipment (left), venue/schedule (right) |
| `gearflowDayHeader` | Day separator with accent bar, date label, phase badges, crew count |
| `gearflowRichText` | Markdown-lite text block (`**bold**`, `*italic*`, `- `/`* ` bullets, word-wrapped to the box width) — replaces the pdfme built-in `text` type for every free-text/paragraph block in the 5 project document layouts: client+project details columns, client notes, total-items note, quote-validity note, terms & conditions. |

**Report Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowDataTable` | Generic configurable table with columns, sections, badges, expanded notes |
| `gearflowSummaryBox` | Horizontal metrics row (e.g., "Total: 42", "Compliance: 95%") |
| `gearflowTextBlock` | Multi-line text — paragraphs, key-value grids, section titles |

### Plugin Architecture
- Plugins receive `value` as JSON string, parse it, draw directly via pdf-lib
- `helpers.ts`: coordinate conversion (mm→pt, Y-flip), font caching (Helvetica/Bold/Courier), color parsing, plain text wrapping (`drawWrappedText`), markdown-lite rich text (`parseRichText`/`drawRichText`/`measureRichTextHeight`/`wrapRichText`/`drawWrappedRichLines`), formatCurrency/formatDate
- `ui` and `propPanel` are stubs (no template designer of any kind — see below)

### Derived Billing Breakdown on Line Items (#943)
`projectLineItems.priceBreakdown` (previously a dead, always-empty field — see
FEATUREDOCS/10 "Derived Billing Weeks/Days") is now populated for every
auto-priced line and rendered directly by `gearflowTable`: a formatted string
like `"2 wk @ $150.00 + 3 d @ $30.00"` or `"charged as 1 wk (capped)"`
(`formatPriceBreakdown`, `src/lib/billing-derivation.ts`) drawn under the
line's description, gated on `TablePluginConfig.showPricing` (a manually
priced line has no stored breakdown, so nothing renders for it). Since #790
removed the entire `{token}` resolution system with no replacement planned
(see "No Template Customization" below), this wires directly into the plugin
— NOT a token — matching how every other derived value already reaches a PDF
in this pipeline.

`document-composer.ts`'s `calculateItemHeight` reserves the matching extra
text-row height using the exact same "does this line have a renderable
breakdown" check the plugin itself uses, so an auto-priced line's breakdown
text can never silently overflow the page's pagination budget — the same
class of tail-drop bug `document-composer.test.ts` guards the rest of the
table against. `getFilteredParentItems` is unaffected — `priceBreakdown`
never gates the top-level status filter.

## No Template Customization

There is no template designer of any kind, and none is planned. The former
"section-based template builder" (per-org stored `TemplateSection[]`/block
tree, visibility conditions, `{token}` resolution, brand templates) was
deleted outright in the #790 redesign, not slimmed:

- `section-renderer.ts`, `section-types.ts`, `condition-evaluator.ts`,
  `token-resolver.ts`, `block-utils.ts`, `template-settings.ts`,
  `sample-document-data.ts`, `plugins/gearflow-rect.ts`, the 6 legacy
  hardcoded single-page builders (`templates/{quote,invoice,packing-list,
  return-sheet,delivery-docket,call-sheet}.ts`) + `templates/shared-builders.ts`,
  `src/lib/validations/template-section.ts`, `src/lib/document-template-read.ts`,
  `src/lib/brand-templates-read.ts`, `src/server/document-templates.ts`,
  and the Convex `documentTemplates`/`brandTemplates`/`sectionPresets` tables +
  CRUD are **all gone** — replaced by the fixed `document-layouts.ts` +
  `document-composer.ts` pair (a few hundred lines total, not a slimmed copy).
- `/settings/documents` (read-only template list) and its nav entry are gone.
- The project page's "Documents" dropdown is plain doc-type items — no
  per-type custom-template submenu (there's nothing to select).
- `/api/documents/template-preview` is gone.
- Org-level branding (colour, logo mode, org name toggle, company details)
  is unaffected — see `src/lib/org-settings-types.ts` / `/settings/branding`.
  Colour precedence is just the org's `documentColor` (no per-template accent
  color to layer over it anymore).

If a future requirement needs per-org document customization again, design it
fresh against the current fixed-layout pipeline rather than reviving any of
the deleted files — see the design doc's rationale for why the old system was
removed (dual pipelines, ~8,300 dead LOC, and the pagination bug it caused).

## Project Document Layouts

5 document types, each with exactly one fixed layout in `DOCUMENT_LAYOUTS`
(`document-layouts.ts`):

| Type | Blocks | `expandProjectGroups` | Status filter |
|------|--------|------------------------|----------------|
| `quote` | header, client+project details, table (`clientFacingTable`: no "/day" price suffix, no badges, no kit/accessory children), totals, client notes, T&Cs (omitted if unset), quote-validity note (real computed date) | false (collapse groups) | none |
| `invoice` | header, client+project details (+ tax ID, payment terms), table (`clientFacingTable`: no badges, no kit/accessory children), totals (+ deposit/balance), client notes | false | none |
| `packing-list` | header, client+project details, table (checkboxes, per-unit, asset tags, categories), total-items note | true (expand groups) | none |
| `return-sheet` | header, client+project details, table (checkboxes, condition columns, per-unit, asset tags), signature (3 cols) | true | `CHECKED_OUT`, `RETURNED` |
| `delivery-docket` | header, client+project details (+ site contact), table (checkboxes, row numbers, per-unit, asset tags), signature (3 cols) | true | `CHECKED_OUT` |

Call sheets are a 6th `DocumentType` value but are **not** in
`DOCUMENT_LAYOUTS` — they render via `templates/call-sheet-services.ts`
instead (`ProjectDocumentType = Exclude<DocumentType, "call-sheet">`).

## Global Document Settings

Org-level, stored in the existing `orgSettings` Convex blob (`OrgSettings.documents`,
`src/lib/org-settings-types.ts`) — no new tables. Validated server-side by
`src/lib/validations/org-settings.ts` (string length caps, `quoteValidityDays` 1-365,
R-8.6.2), the only write path being `updateOrganization()`. Edited on a "Documents"
card at `/settings/branding` ("Branding & documents").

| Setting | Effect |
|---|---|
| `footerText` / `footerSecondLine` | Rendered on every page of every doc type. Empty falls back to an auto-generated `{org name} \| {org email} \| {org phone}` line. |
| `termsAndConditions` | Plain text (no token system) rendered as a block on the quote only. Omitted entirely (zero height, no schema) when unset — no empty box by default. |
| `quoteValidityDays` (default 30) | Feeds a **real computed date** — `document_date + quoteValidityDays` — into the quote's "This quote is valid until {date}" line. Replaces the two hardcoded "valid for 30 days" static-text copies the deleted customization layer used to carry. |

`build-document-data.ts` computes 4 `DocumentData` fields from these settings each
time a document is built: `document_footer_text`, `document_footer_second_line`,
`quote_terms_and_conditions`, `quote_valid_until`.

### Quote/invoice layout refinements (2026-07-27)

- **Header: doc title inline with the logo, not below it.** In `logo` mode,
  `gearflowPageHeader` used to draw the "QUOTE"/"TAX INVOICE" title + doc
  number/date at the same Y as the org name (i.e. below the logo image). It
  now pins the title/meta to the top of the header block (level with the
  logo), independent of the logo's height, and the gap between the logo and
  the org address block below it grew from 8pt to 16pt (`gearflow-page-header.ts`).
- **Details block: no more redundant "Date:" line.** `ProjectDetailsConfig.showDocumentDate`
  now defaults to `false` — the document date already appears in the header
  meta (next to the doc number) on every doc type, so repeating it in the
  client+project details block was redundant. Applies to all 5 doc types.
- **Totals block: more separation from the table, divider no longer overlaps
  the Total text.** `gearflowFinancialSummary` adds 10pt of top padding
  before its first row, and its "Total" divider line now clears both the row
  above and the bold Total text below it (previously the line sat close
  enough to the text baseline to visually strike through "Total"/the amount).
  `document-composer.ts`'s `totals` block height estimate grew from 25mm to
  34mm to match.
- **Quote/invoice table: top-level line items only.** `clientFacingTable`
  (`document-layouts.ts`) sets `showBadges: false` and `showKitChildren: false`
  for both quote and invoice — the client sees line items, groups, and their
  descriptions/notes, not internal warehouse badges (OVERBOOKED/REDUCED STOCK)
  or exploded kit/accessory sub-rows (e.g. a battery accessory as its own
  line under a wireless mic). `showKitChildren` now gates all three
  parent-with-children kinds uniformly — kit children, Project Group members,
  **and** accessories (previously accessories always rendered regardless of
  the flag) — in both `gearflow-table.ts`'s render and `document-composer.ts`'s
  `calculateItemHeight`. Warehouse docs (packing-list/return-sheet/delivery-docket)
  are unaffected — they keep `showKitChildren: true` via `defaultTable`, so
  packers still see every kit member and accessory.

### Markdown-lite text blocks + bold event name (2026-07-27)

Every free-text/paragraph block in the 5 project document layouts — client
notes, terms & conditions, total-items note, quote-validity note, and the
client+project details columns — now renders through the new
`gearflowRichText` plugin instead of pdfme's built-in `text` type
(`document-composer.ts`'s `buildEntryFields`). It reuses the same
markdown-lite convention `gearflowTable` already applies to line-item notes
(`**bold**`, `*italic*`, `- `/`* ` bullets — `parseRichText`/`drawRichText`,
`helpers.ts`), so org-authored terms & conditions and client notes can now
use that formatting, and word-wraps to the box width (`wrapRichText`/
`drawWrappedRichLines`, new exports) so a long paragraph or address wraps
instead of running off the page edge — the built-in `text` type wrapped
automatically; a naive markdown-lite swap would have silently dropped that.

- **Event name is bold.** The details block's project column leads with the
  project/event name; `document-composer.ts` wraps it in `**...**` before
  handing it to `gearflowRichText` — no separate bold-only rendering path,
  just the same markdown convention every other field can now use.
- **`drawRichText` (gearflowTable's existing call, unwrapped) is unchanged
  behaviourally** — it's now a thin wrapper around the shared
  `drawWrappedRichLines(page, parseRichText(text), opts)`, so the table's
  notes-column height math (`measureRichTextHeight`, literal-newline-count
  based) and its existing tests are unaffected. Only the new
  `gearflowRichText` plugin calls the wrapping variant.
- **Pagination height estimates for these blocks remain the pre-existing
  literal-newline-count heuristics** (`estimateBlockHeight` in
  `document-composer.ts`) — they were never wrap-aware even when the
  built-in `text` type did the wrapping, so this isn't a new gap. A very
  long single-line T&Cs paragraph could still under-reserve height; tracked
  as a pre-existing limitation, not introduced here.
- Registered as both `gearflowRichText` and `rvltFlowRichText` in
  `plugins/index.ts` per the rebrand-alias convention
  (`rebrand-plugin-aliases.test.ts`).

### Totals-divider redesign, bold gate, per-item Discount column (2026-07-28)

- **Totals divider, take 2.** The first divider-clearance fix (6pt/16pt →
  reserved height 34mm) still visually read as touching the "Total" text on
  a real render — the arithmetic left only ~1.6pt of clearance once the
  divider line's own 1pt stroke width and the bold size-11 text's real
  ascent (measured via pdf-lib's `font.heightAtSize(11, {descender:
  false})` ≈ 7.9pt, not a guessed constant) were both accounted for.
  `gearflowFinancialSummary`'s divider gap is now 8pt above the line + 16pt
  below it (was 6/10) — ~7.6pt of real clearance, an order of magnitude more
  margin than the minimum needed. `document-composer.ts`'s `totals` block
  height estimate is unaffected by this specific change (still `34` — the
  extra 4pt fit within the existing mm rounding), but see the new
  itemDiscountTotal case below. `gearflow-financial-summary.test.ts` is the
  regression guard: it asserts the line sits strictly between the two rows'
  baselines AND that the Total text's real ascent (not a guess) still can't
  reach the line — this is the shape of test that should have existed
  before the first attempt.
- **Parent-row bold is now gated by `showKitChildren`, matching the
  children-visibility gate.** Previously a kit/group/accessory parent's
  description was unconditionally bold whenever it *had* children, even on
  quote/invoice where those children are hidden (`showKitChildren: false`)
  — the client saw an unexplained bold row with nothing visibly grouped
  under it (e.g. an accessory parent bolded for a battery accessory that
  never renders). `gearflow-table.ts`'s description-cell font is now
  `isParentWithChildren && config.showKitChildren ? fonts.bold :
  fonts.regular`. Warehouse docs (`showKitChildren: true`) are unaffected.
- **Per-item Discount column (quote/invoice).** `projectLineItems.discount`
  (a flat $ amount, already subtracted into `lineTotal` server-side —
  `lineTotal = unitPrice × quantity × duration − discount`, see
  `convex/lineItemWrites.ts`) was already on `DocumentLineItem` but never
  rendered. `getColumnsForDocType`'s quote/invoice columns gained a
  `discount` column between Unit Price and Total (`-$X.XX`, or `-` when
  unset), rendered at all three row tiers (parent/child/grandchild) for
  column-shape consistency, though children never render there today
  (`showKitChildren: false`). Purely additive — no pricing math changed,
  since `lineTotal` already was (and still is) the post-discount figure.
- **"Item Discounts" transparency rows in the totals block.** Because
  `lineTotal`/`subtotal` are already net of each line's own discount, simply
  adding a "Discount" line to the totals block would have double-subtracted
  it. Instead, `FinancialSummaryConfig.itemDiscountTotal` (summed in
  `document-composer.ts`'s `computeItemDiscountTotal` from the same
  structured `data.line_items` the table renders, so it always reconciles
  with what's visible in the new Discount column) drives two rows drawn
  **above** the existing net `Subtotal` row, only when the sum is > 0:
  `Subtotal (before discounts)` (= `subtotal + itemDiscountTotal`) then
  `Item Discounts` (`-$X.XX`). The pre-existing `Discount (X%)` row is
  unrelated — it's still the separate project-wide manual discount
  (`data.discount_percent`/`discount_amount`) applied on top of the net
  subtotal, unchanged. `estimateBlockHeight`'s `totals` case reserves 44mm
  instead of 34mm when `computeItemDiscountTotal(data) > 0`, to fit the two
  extra rows.

### Quote-specific fixes (#790 Phase 4)

- **No "/day" (or other period) price suffix on the quote.** `TablePluginConfig.hidePricingPeriodSuffix`
  (only the quote's `document-layouts.ts` entry sets it `true`) suppresses the
  `PRICING_LABELS` lookup in `gearflow-table.ts`'s top-level price cell. Other doc
  types are unaffected (kit/group child rows never showed the suffix anyway — only
  the top-level unitPrice cell did).
- **Discount, item notes, group notes**: audited end-to-end
  (`document-composer.test.ts`) and confirmed already flowing correctly through the
  new pipeline — `data.discount_amount`/`discount_percent` are unconditional from the
  Convex `projects.discountAmount`/`discountPercent` fields, gated only by the
  quote's `totals.showDiscount` (default `true`); `item.notes` (incl. a Project
  Group's `notes: group.description`) already reaches the table plugin whenever
  `table.showNotes` is `true` (default for quote). No code change was needed here —
  just proof, since these were the class of bug (height/render consumers drifting
  out of sync) this whole redesign targets.
- **Terms & conditions block, real computed quote expiry**: see Global Document
  Settings above.
- **Crewing/services billable-to-client section — deferred, not in this PR.** The
  design doc's Phase 4 checklist calls for a quote section built from billable
  `CrewAssignment`/`ProjectService` rows gated by `billableToClient`. That field
  exists on the Convex `projectServices` schema but has **no UI to set it anywhere
  in the app** (confirmed by grep — the one place it's read,
  `project-service-read.ts`, defaults it to `false` when absent). Gating the
  existing quote services injection (`build-document-data.ts`'s `showOnDocuments`
  filter, already live) by `billableToClient` today would silently hide every
  existing org's services from every quote, since no org has ever been able to set
  the field `true`. Shipping the gate without the UI control would recreate exactly
  the "feature nobody can reach" anti-pattern this redesign removed. Needs a
  `billableToClient` toggle added to the project-services edit UI first — tracked
  as a follow-up, not silently dropped.
- **General tidiness pass per DESIGN.md**: DESIGN.md §6 explicitly defers PDF
  branding/visual changes ("Do not apply RVLT design system colors or fonts to PDF
  templates in this redesign") — so no visual re-skin was done here. The block
  ordering (header → details → table → totals → notes → T&Cs → validity) matches
  the pre-redesign section defaults.

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

### SALE Line Handling (WS11 #950)
`DocumentLineItem` gained a `type` field (`src/lib/pdfme/types.ts`) so the table
plugin and composer can special-case `SALE` lines without inferring it from
other fields:
- **Quote / invoice**: SALE lines included, with a green "SALE" badge
  (`BADGE_STYLES.sale`, `gearflow-table.ts`). No `/day` (or other period)
  price suffix — a SALE line is always `pricingType: FLAT`, whose label is
  already "flat", so it's unaffected by the quote's `hidePricingPeriodSuffix`.
- **Delivery docket / packing list**: SALE lines are **always** included,
  regardless of status — goods are handed over at the docket, never checked
  out through the warehouse flow. Packing-list has no `filterByStatus` at
  all, so this was already true there; the docket's `["CHECKED_OUT"]` filter
  special-cases `type === "SALE"` to bypass it, in both
  `document-composer.ts`'s `getFilteredParentItems` and `gearflow-table.ts`'s
  mirrored top-level filter (see the audit checklist below — both had to move
  together).
- **Return sheet**: SALE lines excluded entirely, regardless of status — a
  sold item is never expected back.
- Sale lines ride in their existing category/group bucket — there is no
  separate "Sales" section; the badge is the only differentiator.

## T&T Reports

10 report types generated via pdfme, each with a template builder in `src/lib/pdfme/templates/tt-*.ts`. API route: `GET /api/test-tag-reports/[reportType]?format=pdf|csv`. CSV export is unchanged. These builders are **not** part of the project-document pipeline above and were unaffected by the #790 redesign.

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
| `/api/documents/[projectId]` | GET | Generate project document. Param: `type` (quote/invoice/pull-slip/delivery-docket/return-sheet) |
| `/api/documents/call-sheet/[projectId]` | GET | Generate call sheet. Params: `date`, `dates` (comma-separated), `allDates=true`, `crewMemberId`, `crewRoleId` (all optional). |
| `/api/documents/timeline/[projectId]` | GET | Generate project timeline PDF |
| `/api/test-tag-reports/[reportType]` | GET | Generate T&T report. Params: `format` (pdf/csv), filters (dateFrom, dateTo, status, equipmentClass, etc.) |

## Line item structuring

`structureLineItems(rawItems, categories, options, subHireGroups)` is the
pure helper that decides how rows bucket on the PDF. It runs once per
document inside `buildDocumentData`, driven by `options.expandProjectGroups`
(sourced from `DOCUMENT_LAYOUTS[docType].expandProjectGroups`, not a stored
setting — see Architecture above).

Two modes selected by `options.expandProjectGroups`:

- **collapse** (`quote`, `invoice`): each Project Group
  collapses into one synthetic `isGroupRow: true` row. Children dropped
  so the client sees "Lighting Package x1 @ $5000" rather than every
  itemised lamp. Sub-hire items stay inside their target category so
  category subtotals roll up correctly.
- **expand** (`packing-list`, `return-sheet`,
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
  by `options.packerSort`, tied 1:1 to `expandProjectGroups` (every
  expand-mode doc also wants packer order).

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state uses rotated lines
- Line item notes shown as subtitles
- Markdown-lite formatting (`**bold**`, `*italic*`, `- `/`* ` bullets — `parseRichText`/`drawRichText` in `helpers.ts`) works anywhere text flows through `gearflowTable` (item/group notes) or `gearflowRichText` (client notes, terms & conditions, details columns, system notes). No other markdown syntax (links, headings, tables) is supported.
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units
- Per-unit rows (`showPerUnitCheckboxes`): a qty > 1 line expands to one row per assigned unit ("Unit 1 — TTP00042", …) instead of collapsing tags to "tag, tag +N". On for `packing-list`, `return-sheet`, and `delivery-docket` — a single literal in each doc type's `DOCUMENT_LAYOUTS` entry (there is exactly one default source now, not two that have to be kept in sync).

## PDF Data-Shape Consumers (audit checklist)

Any change to the `DocumentLineItem` shape (new field, new synthetic row
type, new relationship) must be verified against all consumers below —
fixing one and shipping leaves silent bugs in the others (see CLAUDE.md's
PDF footgun section for the pre-#790 history of exactly this):

1. **`gearflow-table.ts` rendering** — what gets drawn (bold, indented, etc.)
2. **`document-composer.ts`'s `calculateItemHeight`** — pagination space reservation (miss this → silent tail-drop)
3. **`document-composer.ts`'s `getFilteredParentItems`** — status filter (miss this → items disappear from docket / return-sheet)
4. **`gearflow-table.ts`'s own top-level filter** — mirrors #3, must stay in sync (documented cross-reference in both files)

This is down from 5 consumers in 2 files pre-redesign (the dual pipeline
meant `section-renderer.ts` and `gearflow-table.ts` each had their own filter
+ height-estimation logic that had to be kept in sync by hand); the fixed
single pipeline collapses it to one file (`document-composer.ts`) plus the
plugin's own top-level filter.

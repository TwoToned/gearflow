# PDF Document Generation

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-28 (review quarterly — POLICY.md R-5.5)_

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
| `src/server/finance-documents.ts` | **Immutable finance artifacts (#987)** — renders a quote/invoice PDF ONCE at send/issue, uploads it to Convex `_storage`, attaches the storage id. The only writer of `quotes.pdfFileId` / `invoices.pdfFileId`. |
| `src/lib/finance-artifacts.ts` | Artifact file naming (`RVLT-2026-0087-quote-v2.pdf`) + filename sanitising — one definition shared by the upload and the download routes. |
| `src/lib/finance-artifact-response.ts` | Streaming half of the two artifact routes: org re-check on the stored file, headers, and deliberately **no** regeneration fallback. |
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
| `gearflowDraftWatermark` | "DRAFT PREVIEW — NOT SENT" banner (#987). Only ever produced by `?preview=1`; a stored artifact never carries one. Page furniture — repeated under the header on **every** page (see "Immutable finance artifacts"). Helvetica can't encode an em dash, so the plugin normalises `—`/curly quotes before drawing. |
| `gearflowRichText` | Markdown-lite text block (`**bold**`, `*italic*`, `- `/`* ` bullets, word-wrapped to the box width) — replaces the pdfme built-in `text` type for every free-text/paragraph block in the 5 project document layouts: client+project details columns, client notes, total-items note, terms & conditions. When real font metrics are available (`generate-pdf.ts`), clientNotes/termsAndConditions also split across pages by wrapped line instead of only ever moving whole — see "Wrap-accurate pagination" below. |

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
| `quote` | header (+ "Expiry: {date}" meta line, real computed date), client+project details, table (`clientFacingTable`: no "/day" price suffix, no badges, no kit/accessory children), totals, client notes, T&Cs (omitted if unset) | false (collapse groups) | none |
| `invoice` | header (+ bold "Due: {date}" meta line), client+project details (+ tax ID, payment terms), table (`clientFacingTable`: no "/day" price suffix, no badges, no kit/accessory children), totals (+ deposit/balance, + bold "Due Date" row), payment details (omitted if unset), client notes, T&Cs (omitted unless `showTermsAndConditionsOnInvoice` is on AND text is set) | false | none |
| `packing-list` | header, client+project details, table (checkboxes, per-unit, asset tags, categories), total-items note | true (expand groups) | none |
| `return-sheet` | header, client+project details, table (checkboxes, condition columns, per-unit, asset tags), signature (3 cols) | true | `CHECKED_OUT`, `RETURNED` |
| `delivery-docket` | header, client+project details (+ site contact), table (checkboxes, row numbers, per-unit, asset tags), signature (3 cols) | true | `CHECKED_OUT` |

The `header` block itself is the SAME across all 5 doc types (`document-composer.ts`'s
one `case "header"` in both `estimateBlockHeight` and `buildEntryFields`) — the org's
business-registration number (when set) renders under the address/phone/email lines on
**every** doc type, not just the invoice. Only the "Expiry"/"Due" meta lines next to the
doc number are doc-type-gated.

**Labels are country-derived, not hardcoded (I4, #1083).** `data.org_business_number_label`
(from `src/lib/countries.ts` via `build-document-data.ts`) replaces the literal `"ABN"` for
BOTH the org's own number (header) and the client's (`detailsRow`'s `showClientTaxId`
line) — one label, since it names the org's home-jurisdiction registration-number format
("VAT number" for GB/IE, "EIN" for US, …), not a per-party thing. `data.tax_label`/
`org_tax_label` fall back to the country's `taxLabel` (not a literal `"GST"`) when
`OrgSettings.taxLabel` is unset. `data.org_invoice_heading` overrides the invoice layout's
static `"TAX INVOICE"` title (`document-layouts.ts`) for any non-AU/NZ org — "Tax Invoice"
is an AU/NZ GST-system legal term, not a global one; every other market gets "INVOICE".
None of this touches `OrgSettings.abn`/`Client.taxId` themselves (still generic storage,
per their own doc comments) — this is a render-layer change only.

Call sheets are a 6th `DocumentType` value but are **not** in
`DOCUMENT_LAYOUTS` — they render via `templates/call-sheet-services.ts`
instead (`ProjectDocumentType = Exclude<DocumentType, "call-sheet">`).

`getDocumentLayout(docType, { draftPreview: true })` (#987) returns the same
layout with one extra block spliced in after the header: `draftWatermark`. It is
the ONE variant of a fixed layout that exists, it is never persisted, and only
`/api/documents/[projectId]?preview=1` asks for it.

## Immutable finance artifacts (#987)

A quote or invoice PDF is **rendered once and stored**, then never regenerated:

```
send / issue ──▶ src/server/finance-documents.ts (pdfme runs in Node)
                   └─▶ generatePdf(...) ──▶ uploadToS3()   [= Convex _storage]
                         └─▶ storageId ──▶ quotes.pdfFileId / invoices.pdfFileId
                                            (convex/financeArtifacts.ts — attach ONCE)
```

Before this, `/api/documents/[projectId]?type=quote` re-rendered from live
project state on every click: two downloads a week apart produced two different
documents under the same name, and the document the client was actually holding
existed nowhere in the system. Storing the bytes makes immutability structural
instead of disciplinary — a "reconstruct it from the snapshot" path would
re-execute ~1,400 lines of `build-document-data.ts` plus the composer, so any
later change to that code would silently rewrite historical documents.

What this changes in the PDF pipeline itself:

| Concern | Behaviour |
|---|---|
| **Dates** | `buildDocumentData(..., { stampedDates })` takes `documentDate` / `quoteValidUntil` from the frozen row. `quote_valid_until` used to be recomputed from `now` on every render, so re-opening an old quote silently extended how long it was valid. The `now` fallback now only applies to a preview, which has no stamped dates because nothing has been sent. |
| **Watermark** | `draftWatermark` is **page furniture** (like the header): `measurePageFurniture()` reserves its height and `placePageFurniture()` repeats it on every page. A banner on page 1 of a 4-page quote is not a warning — and an unreserved block is the v0.8.1.1 tail-drop bug. |
| **Retrieval** | `/api/finance/{quote,invoice}/…/pdf` streams the stored bytes. There is deliberately no regeneration fallback: a route that can regenerate is a route that can hand the client a different document under the same name. |
| **Failure** | A `SENT` quote with a null `pdfFileId` is a real state — the render runs after the Convex transaction commits and can fail on its own. The finance panel shows "Document missing — generate", and the attach mutation refuses to overwrite, so a retry can never rewrite history. |

Superseded, recalled and voided rows keep their artifacts: the client may be
holding that copy, so deleting ours makes the record worse, not better.

## Global Document Settings

Org-level, stored in the existing `orgSettings` Convex blob (`OrgSettings.documents`,
`src/lib/org-settings-types.ts`) — no new tables. Validated server-side by
`src/lib/validations/org-settings.ts` (string length caps, `quoteValidityDays` 1-365,
R-8.6.2), the only write path being `updateOrganization()`. Edited on a "Documents"
card at `/settings/branding` ("Branding & documents").

| Setting | Effect |
|---|---|
| `footerText` / `footerSecondLine` | Rendered on every page of every doc type. Empty falls back to an auto-generated `{org name} \| {org email} \| {org phone}` line. |
| `termsAndConditions` | Plain text (no token system) — always rendered as a block on the quote when set. Omitted entirely (zero height, no schema) when unset — no empty box by default. |
| `showTermsAndConditionsOnInvoice` (default off) | Invoice-only opt-in: when on AND `termsAndConditions` is set, the SAME text also renders as a block on the invoice (its own forced page, same as the quote). An invoice already carries its own payment terms/due date, so T&Cs there is opt-in rather than always-on like the quote. No separate per-doc-type text — one org-authored block, two doc types. |
| `paymentDetails` | Plain text (no token system) — bank name, BSB, account number, reference, etc. Invoice only, rendered directly after the totals block (same page whenever the two fit together — never forced to its own page, unlike T&Cs). Omitted entirely when unset. |
| `quoteValidityDays` (default 30) | The org DEFAULT `sendNative` stamps `validUntil` from at send time (#986). A SENT revision's document renders that stamped date, not a fresh computation (#987); only the draft preview still derives it live. Feeds a **real computed date** — `document_date + quoteValidityDays` — into the quote header's "Expiry: {date}" meta line (2026-07-28 — previously its own "This quote is valid until {date}." sentence at the bottom of the document; moved into the header alongside the doc number/date so it's visible without scrolling to the end of a possibly multi-page quote — see below). Replaces the two hardcoded "valid for 30 days" static-text copies the deleted customization layer used to carry. |
| `paymentTermsDays` (default 14) | Same "stamped row wins, live fallback for previews" shape as `quoteValidityDays` (see `invoice-terms.ts`), now ALSO feeds a real computed **invoice due date** into two places: a bold "Due: {date}" header meta line (next to the doc number, same treatment as the quote's Expiry line) and a bold "Due Date" row at the bottom of the totals block. An ISSUED invoice's own `dueDate` row wins over the live computation once one exists (`generateInvoiceArtifact`'s `stampedDates.invoiceDueDate`). |

Org-level ABN (Australian Business Number, or local equivalent) is a separate
top-level `OrgSettings.abn` field (not under `documents` — it's business
identity, edited on the General settings page next to address/email/phone).
Rendered in the PDF header, under the org's address/phone/email lines, on
**every** doc type — Tax Invoices legally require it, but it's shown wherever
the org details block itself renders rather than singled out to that one
type. Omitted when unset. The printed LABEL next to it is country-derived
("ABN" only for AU; see the I4 note above) — the stored field name/comment
stays generic on purpose.

`build-document-data.ts` computes these `DocumentData` fields from the settings
above each time a document is built: `document_footer_text`,
`document_footer_second_line`, `terms_and_conditions` (gated by the invoice
toggle above when `docType === "invoice"`), `quote_valid_until`,
`invoice_due_date`, `payment_details`, `org_abn`, `org_business_number_label`,
`org_invoice_heading` (I4, #1083 — both derived from `src/lib/countries.ts`
via `OrgSettings.country`, defaulting to the AU labels for an org that hasn't
set one).

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

### Wrap-accurate pagination for free-text blocks, "Uncategorized zone" Project Groups, quote expiry moved to the header (2026-07-28)

**Accurate pagination for clientNotes/termsAndConditions — no more silent
footer overlap or empty trailing pages.** A long org T&Cs block (numbered
sections with several clauses long enough to word-wrap) exposed two related
bugs:
- `estimateBlockHeight`'s `termsAndConditions`/`clientNotes` cases counted
  literal `\n`s in the source text to estimate height — but `gearflowRichText`
  word-wraps to the box width at render time (2026-07-27), so a long clause
  could render as 2+ physical lines while only counting as 1 in the estimate.
  The reserved space under-shot the real rendered height, and the actual text
  ran past its box — visually into the footer on the affected page.
- Because `termsAndConditions`/`clientNotes` could only ever move as ONE
  whole block to a fresh page (never split, unlike the `table` block), a
  block that nearly filled a fresh page left almost nothing for whatever
  came after it — a one-line `quoteValidityNote`-style block could end up
  alone on its own near-empty page.

Fixed properly, not patched around: `composeDocument(docType, data, docColor,
fonts?)` gained an **optional 4th parameter** — real embedded Helvetica fonts
(`RichTextFonts`, `helpers.ts`). `generate-pdf.ts` embeds them once (a
throwaway `PDFDocument.create()` used purely for font metrics, never
rendered) and passes them through. When `fonts` is supplied:
- `estimateBlockHeight` measures the block's ACTUAL wrapped line count via
  `wrapRichText()` — the exact same function `gearflowRichText` uses to
  render — instead of the raw-newline heuristic. `richTextLineHeight(fontSize)`
  (`helpers.ts`) is the single shared line-advance formula both the estimate
  and the plugin's render default use, so they can never drift apart again
  (the class of bug CLAUDE.md's PDF "audit checklist" exists to prevent).
- `computePages`'s `splitRichTextBlock` (mirrors `splitTable`, but simpler —
  wrapped lines are uniform-height and atomic, no sub-items/children) wraps
  the block ONCE up front and fills each page with as many whole lines as
  fit, continuing the rest on the next page(s) — a `termsAndConditions` block
  longer than a single page's content height now actually spans multiple
  pages instead of silently overflowing the one it was squeezed onto.
- `PageEntry.textLines` carries the pre-wrapped slice for that page.
  `buildEntryFields` passes it to `gearflowRichText` as `{ lines: [...] }`
  JSON instead of the raw markdown string — the plugin draws the given lines
  directly with **zero re-wrapping**, so the exact line breaks that drove the
  page-break math are the exact line breaks rendered; they cannot diverge.

**Backward-compatible by construction, not by exception.** `composeDocument`
stays fully synchronous; `fonts` is optional specifically so every existing
caller/test that doesn't pass it keeps its EXACT prior behavior (raw-newline
estimate, whole-block-only movement, plugin wraps the raw string itself at
render time) — confirmed by the full existing test suite passing unchanged.
Only `generate-pdf.ts` (the real render path) and new pagination-specific
tests opt into the accurate path. See `document-composer.test.ts`'s "accurate
rich-text pagination (fonts provided)" describe block.

**"Uncategorized zone" Project Groups now collapse/expand correctly instead
of splitting into flat items.** A `ProjectGroup` can have `categoryId: null`
— the equipment tab's "Uncategorized" zone is a first-class, fully-supported
state there (`equipment-tab.tsx`), not an error. But
`buildDocumentLineItemData` (`project-line-item-read.ts`) only ever nested
groups under a REAL category (`mappedGroups.filter(g => g.categoryId ===
c.id)`) when building the `categories` array `structureLineItems` reads —
an uncategorized group was invisible to it: its own synthetic collapsed row
never rendered, and (in expand/warehouse mode) its members' `groupChildren`
match failed too, since it was keyed on `groupTitle === group.title &&
categoryName === cat.name` and a member's OWN `categoryName` is null
whenever its `categoryId` is unset — even though the member correctly
carries `groupId` pointing at the group. Net effect: the whole group printed
as disconnected flat line items on quotes/invoices instead of one collapsed
row (and vanished from warehouse docs' childLineItems entirely).

Fixed two ways, together:
1. `buildDocumentLineItemData` now folds every `categoryId: null` group into
   a synthetic pseudo-category `{ id: "__uncategorized__", name: "", groups:
   [...] }` appended to `categories`. `name: ""` buckets its synthetic row
   under each doc type's normal "no header" fallback
   (`groupName || prepContainer || ungroupedKey`) rather than printing a
   spurious "Uncategorized" section title on a client-facing document.
2. `structure-line-items.ts`'s member matching (`groupChildren`,
   `hasGroupContent` in expand mode) now keys off `groupId` (the FK, added
   to `DocumentLineItem` — `structureLineItems — Uncategorized-zone Project
   Group` in `structure-line-items.test.ts`) first, falling back to the old
   `groupTitle`+`categoryName` string match only when `groupId` is absent
   (in practice: this file's own test fixtures, which predate the field —
   real data from `buildDocumentLineItemData` always sets `groupId`
   whenever `groupTitle` is resolved from it, so production traffic always
   takes the id-based path).

**Quote expiry moved into the header.** The quote's "This quote is valid
until {date}." sentence used to be its own block at the very end of the
document (`quoteValidityNote` — now deleted from `LayoutBlock` and
`DOCUMENT_LAYOUTS.quote.blocks` entirely, since nothing else used it). It's
now a third header-meta line, "Expiry: {date}", next to the doc number/date
(`document-composer.ts`'s `header` case, quote-only,
`docType === "quote" && data.quote_valid_until`) — visible immediately
without scrolling to the end of a possibly multi-page quote.
`estimateBlockHeight`'s `header` case reserves 5mm of extra height for the
quote's 3-line meta block (vs. the usual 2 lines) as a safety margin, mirroring
the "reserve generously, don't cut it close" lesson from the totals-divider
fix above.

### Sub-hire row tail-drop, T&Cs forced onto its own page, client name bolded (2026-07-28)

**Critical: sub-hire rows silently under-reserved height, dropping entire
trailing categories off real quotes.** `calculateItemHeight`
(`document-composer.ts`, the pagination estimate) had no case for the
"via `<Supplier>`" line `gearflow-table.ts` unconditionally draws under a
sub-hire item's description (`item.subHireId != null && item.supplierName`
— 10pt, `fontSize(9) + 1`). Every sub-hire row's real rendered height
silently exceeded what was reserved for it. On a quote with many sub-hire
lines (a normal shape — most of a production's gear is commonly hired in
from suppliers) this compounds fast: `splitTable`'s `fitItems` believed more
rows fit on page 1 than actually did, `endIndex` came back `undefined`
("render everything, nothing more to paginate"), and `gearflow-table.ts`'s
own render-time overflow guard (`if (currentY - rowContentHeight <
bottomBoundary) { overflow = true; break; }`) then silently stopped
mid-page — with **no continuation page ever scheduled for the table**, since
document-composer.ts never knew there was more to show. Real-world impact:
a quote reporting ~$8,480 of line items (an entire "Lighting" category tail
plus a whole other category, ~$14.8k true subtotal vs. ~$6.4k of rows
actually drawn) with the correct total still showing at the bottom — the
subtotal is computed independently of `data.line_items`, so it stayed
correct while the visible table silently lost rows. This is the exact class
of bug the #790 redesign's "no tail-drop" guarantee — and this file's own
"PDF Data-Shape Consumers" audit checklist — exists to prevent; it slipped
through because the sub-hire "via Supplier" line was added to
`gearflow-table.ts` without a matching case in `calculateItemHeight`.
Fixed by adding the missing case, byte-identical to `gearflow-table.ts`'s
own check. Regression coverage: `calculateItemHeight — sub-hire 'via
Supplier' line (tail-drop regression)` in `document-composer.test.ts` —
both a direct height-comparison unit test and a full-pipeline test (5
categories, alternating sub-hire/owned rows, `assertFullCoverage`) that
would have caught this before it shipped.

**T&Cs always starts on its own page.** `LayoutBlock`'s `termsAndConditions`
variant gained `forceNewPage?: boolean` (set `true` on the quote's entry in
`document-layouts.ts`) — the legal boilerplate now always begins on a fresh
page rather than sharing whatever room happens to be left on the page above
it (previously it could share the tail of the totals/client-notes page, or
end up split awkwardly close to the totals block). `computePages`'s
`needsForcedPageBreak` checks it before the normal fits-or-splits logic;
it's a no-op when T&Cs is already first on a fresh page (e.g. right after a
table that already forced its own continuation page), so this never inserts
an extra blank page.

**Client name bolded, matching the event name.** The details block's client
column leads with the client's name; `document-composer.ts` now wraps it in
`**...**` before handing it to `gearflowRichText`, the same convention
already used to bold the project column's leading line.

### Uncategorized section gets a real header; group headers stop repeating on continuation pages (2026-07-28)

**Uncategorized items were visually merging into the category printed above
them.** Two spots fed rows into the table with a falsy `groupName`, and
`gearflow-table.ts`'s bucketing (`item.groupName || item.prepContainer ||
ungroupedKey`) treats any falsy `groupName` as "no section, no header" —
correct for items that genuinely have no place on the doc, wrong for items
the office just hasn't filed under a category yet:

1. `buildDocumentLineItemData` (`src/lib/project-line-item-read.ts`) folds
   Project Groups living in the equipment tab's "Uncategorized" zone
   (`ProjectGroup.categoryId: null`) into a synthetic pseudo-category —
   previously `{ id: "__uncategorized__", name: "" }`, deliberately blank so
   it fell through to the same silent fallback. Now `name: "Uncategorized"`.
2. `structureLineItems`'s final branch (line items with no category AND no
   group at all) pushed them through with whatever `groupName` they already
   had (typically none). Now explicitly bucketed under `"Uncategorized"` via
   the existing `kitBucketLabel` helper, same as every other category bucket.

Both now get a normal section header + divider, same visual treatment as any
named category — no more silent blending into whatever printed above them.
Regression coverage: `structure-line-items.test.ts`'s "Uncategorized-zone
Project Group" describe block (updated to assert `groupName: "Uncategorized"`
instead of `""`) plus the Phase-0 integration fixture's uncategorized custom
item.

**A long category's header was redrawing at the top of every continuation
page it spanned.** `gearflow-table.ts` recomputes the full `groups` Map on
every page render call (each page gets the complete `items` array plus its
own `startIndex`/`endIndex` slice) and used to draw a group's header
whenever *any* of its items fell within that page's slice — including a page
that only continues a group whose header already printed on the page
before. Fixed by tracking `groupStartIdx` (the group's position before its
own items) and skipping the header draw when `groupStartIdx < startIndex`
(the group started on an earlier page). `document-composer.ts`'s
`splitTable` height budget had a matching "reserve extra `GROUP_HEADER_PT`
on a continuation page whose leading group already printed its header
earlier" branch — that was deliberately compensating for the old
repeat-on-continuation render behavior, so it's now dead weight and was
removed in lockstep (along with the `groupHeaderIdx`/`entryGroupKey`
bookkeeping that only existed to feed it). Leaving either side unfixed alone
would have reintroduced a height/render mismatch — the exact class of bug
the "PDF Data-Shape Consumers" checklist below exists to catch, extended
here to cover a render *condition* change, not just a shape change.
Regression coverage: `gearflow-table.test.ts`'s "group header does not
repeat on a continuation page" describe block (renders page 1 and a
simulated continuation page directly via `runTablePlugin`'s new
`startIndex`/`endIndex` param) and `document-composer.test.ts`'s "group
header prints once across a multi-page group" full-pipeline test (100-item
single-category fixture spanning 3+ real composed pages, counts header draws
across every page via `runTablePlugin`).

### Header/totals spacing tightened — reserved height now tracks actual draw geometry (2026-07-31)

**The gap between the header and the client/project details row was
noticeably larger in `logo` mode than `icon` mode, for no visual reason.**
`estimateBlockHeight`'s `header` case used flat per-mode constants (`25mm`,
or `47mm` in `logo` mode, +5mm per extra meta/ABN/due-date line) regardless
of how much the header actually draws. `gearflow-page-header.ts`'s `logo`
mode reserves a fixed 50pt-tall logo row whether or not the org name is
even shown underneath it (`showOrgNameOnDocuments` can be `false`), so a
common real-world header (logo, org name hidden, 3-4 detail lines) left
~20mm of dead whitespace before the details row — the reserved height
assumed a taller org-name+details stack than the header actually drew.
Fixed by measuring the header's real content instead of guessing at it:
`estimateBlockHeight`'s `header` case now computes the left column (logo
row if `mode === "logo"`, org name row if shown, one row per populated
org-detail line — address/phone/email/ABN/website, mirroring
`buildEntryFields`'s `orgDetailParts` exactly) and the right column (title
+ meta lines, +1 for a quote's Expiry line, + the invoice due-date
highlight), reserving `Math.max(leftColumn, rightColumn, iconFloor) + 4mm`
padding instead of a flat constant. Icon-mode headers (the common case) are
essentially unchanged (~35mm either way for a typical org); logo-mode
headers with the org name hidden shrink from ~57mm to ~44mm for the same
data — the gap that was reported as "a decent gap from the page header to
the content." `document-composer.test.ts`'s existing full-pipeline tests
(none of which pinned a specific header height) still pass unmodified.

**GST → Total spacing in the totals block trimmed slightly.** The Total
row's divider clearance (see "Totals-divider redesign" above, 2026-07-28)
was deliberately generous — 8pt before the line, 16pt after it — after an
earlier 6pt/10pt pair visibly touched the bold "Total" text. Tightened to
6pt/13pt: still 3pt above the known-bad 10pt on the side that actually
touched (the space before the bold Total text), while trimming ~5pt
(~1.8mm) of visible gap between the GST row and the Total row.
`gearflow-financial-summary.test.ts`'s existing clearance assertions
(divider strictly between the two rows' baselines, Total's real ascent
still clear of the line) still pass unmodified.

### Quote-specific fixes (#790 Phase 4)

- **No "/day" (or other period) price suffix on the quote or invoice.** `TablePluginConfig.hidePricingPeriodSuffix`
  (the quote and invoice `document-layouts.ts` entries both set it `true`) suppresses the
  `PRICING_LABELS` lookup in `gearflow-table.ts`'s top-level price cell — a client-facing
  document shows a plain rate, not "$150.00/day". The 3 warehouse doc types are unaffected
  (kit/group child rows never showed the suffix anyway — only the top-level unitPrice cell
  did, and warehouse staff aren't reading a client rate off it).
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
  existing quote services injection (`build-document-data.ts`'s billable-services
  filter — since superseded to gate on `lineTotal > 0` rather than the old
  `showOnDocuments` flag, see FEATUREDOCS/10 "Margin Display") by `billableToClient`
  today would silently hide every
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
| `/api/documents/[projectId]` | GET | Generate a **warehouse** project document from live state. Param: `type` (pull-slip/delivery-docket/return-sheet). `type=quote`/`type=invoice` are **400 unless `preview=1`** (#987), which additionally requires `invoice:read` and stamps the DRAFT PREVIEW watermark. |
| `/api/finance/quote/[quoteId]/pdf` | GET | Stream the **stored** quote artifact. `invoice:read` + org check (`quotes.by_cuid` is global — R-8.4.3). No regeneration path; 404 when a revision has no artifact. |
| `/api/finance/invoice/[invoiceId]/pdf` | GET | Stream the **stored** invoice artifact. Same guards. A VOIDed invoice keeps its document. |
| `/api/documents/call-sheet/[projectId]` | GET | Generate call sheet. Params: `date`, `dates` (comma-separated), `allDates=true`, `crewMemberId`, `crewRoleId` (all optional). |
| `/api/documents/timeline/[projectId]` | GET | Generate project timeline PDF |
| `/api/test-tag-reports/[reportType]` | GET | Generate T&T report. Params: `format` (pdf/csv), filters (dateFrom, dateTo, status, equipmentClass, etc.) |

### Agent-facing document access (`GET /api/v1/documents/{projectId}` + MCP `get_project_document`)

An API key / MCP caller gets the same 5 project documents a session user does,
through a bearer-authenticated counterpart to the two route families above —
`src/lib/api/documents.ts`'s `resolveProjectDocument(actor, projectId, docType)`,
shared by the REST route and the MCP tool. It is deliberately **not** a Convex
registry operation: `build-document-data.ts` reads Prisma AND Convex, so it can
only ever run as Node code the dispatcher can't reach (see the file's own doc
comment, and the "why not dispatch()" note in `src/lib/api/mcp/build-server.ts`).
Auth still goes through the same `requirePermission` scope∩RBAC check every
other write/read on this surface uses — just called directly (Node-side)
instead of inside a Convex guard.

| `docType` | Behaviour | Permission |
|---|---|---|
| `packing-list` (pick slip / pull slip), `return-sheet`, `delivery-docket` | Always live-rendered from TODAY's state, same as the session route. | `project:read` |
| `quote` | The stored artifact if one is SENT; otherwise a watermarked DRAFT PREVIEW live render (never stored). | `invoice:read` |
| `invoice` | The stored artifact for the most recently ISSUED invoice; `NOT_FOUND` if none has been issued yet (no draft form). | `invoice:read` |

Both `project:read` and `invoice:read` are in the `read_only_agent` preset
(`src/lib/api-key-presets.ts`), so this works out of the box for a plain
read-only key — no `full_agent`/write scopes needed just to view paperwork.

The MCP tool returns a short-lived download URL + metadata as plain JSON
(`resolveProjectDocumentUrl`) — the one curated tool other than `whoami` that
doesn't go through `dispatch()`, but still JSON-only like every other tool.
**An earlier version embedded the PDF inline as a base64 MCP `resource`
content block** (`EmbeddedResource`/`BlobResourceContents`); that shipped
2026-07-30 and broke within hours in real client use — some layer in the
actual MCP relay path stripped/nulled fields it didn't recognise (`_meta`,
`blob`) before the result reached the calling client's own schema
validation, failing with `Invalid tools/call result`. Fixed same-day by
returning a URL instead (`files.getServeInfo`'s already-established "give an
agent a fetchable URL" pattern) — a live-rendered document (no persisted
artifact to point at) is first uploaded to Convex `_storage` under
`agent-documents/` so there's something to resolve a URL for; this is a
disposable snapshot, never attached to any row, and isn't cleaned up today
(a known follow-up, not a correctness issue). The REST route is unaffected
by any of this — it always streamed bytes directly
(`Content-Type: application/pdf`) and never used the blob-content path. See
[56-api-mcp.md](./56-api-mcp.md).

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

Applies to both modes: line items with no category and no group at all
bucket under a literal `"Uncategorized"` section (2026-07-28) — same
section header + divider treatment as a real category, not a blank/falsy
`groupName` that silently merges them into whichever bucket printed above.

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state uses rotated lines
- Line item notes shown as subtitles
- Markdown-lite formatting (`**bold**`, `*italic*`, `- `/`* ` bullets — `parseRichText`/`drawRichText` in `helpers.ts`) works anywhere text flows through `gearflowTable` (item/group notes) or `gearflowRichText` (client notes, terms & conditions, details columns, system notes). No other markdown syntax (links, headings, tables) is supported.
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units
- Per-unit rows (`showPerUnitCheckboxes`): a qty > 1 line expands to one row per assigned unit ("Unit 1 — TTP00042", …) instead of collapsing tags to "tag, tag +N". On for `packing-list`, `return-sheet`, and `delivery-docket` — a single literal in each doc type's `DOCUMENT_LAYOUTS` entry (there is exactly one default source now, not two that have to be kept in sync).

### Discount column prints the discount as it was ENTERED (#1012, 2026-07-28)

The Discount column always resolved to dollars — a line negotiated at "15%"
printed `-$150.00`, because **discount mode was never persisted anywhere**.
`resolveDiscountAmount` converted `%` → flat dollars client-side and only the
resulting number crossed into the mutation, by design (`discount` is the one
number recalc / invoicing / `lineTotal` all read).

`projectLineItems.discountMode` and `projectGroups.discountMode`
(`v.optional(enums.DiscountMode)` — `"$" | "%"`) now record the **entry shape**
alongside that dollar amount. Absent = `"$"`, which is byte-identical to the old
behaviour, so **no backfill** was needed. Nothing about pricing math changed:
the mode is display-only.

- **The percentage is DERIVED, never stored.** `discountCellText` in
  `gearflow-table.ts` recomputes it from the stored dollar amount against the
  row's own gross (`unitPrice × quantity × duration`, via `lineGrossAmount`).
  Storing the typed `15` would let a document contradict itself: the dollar
  amount is frozen at save time, so a later unit-price change would print "15%"
  next to numbers that say 7.5%. Deriving keeps the printed percentage and the
  printed line total in agreement by construction, and leaves one source of
  truth for the discount (R-3.1). A `%` row whose gross is `0` (no percentage
  is expressible) falls back to the dollar amount.
- **One helper, three row tiers.** `discountCellText` is shared by the parent,
  kit/accessory-child and per-unit-grandchild renderers, which previously had
  three hand-rolled copies of the same `-${formatCurrency(...)}` expression.
- **Synthetic Project Group rows** carry `discountMode` through
  `structure-line-items.ts`; the row's `unitPrice`/`quantity`/`duration`
  (bundle price × qty × 1) are the gross the percentage is measured against.
- **No pagination impact** — the cell is still a single line at every tier, so
  `calculateItemHeight` is unchanged (checklist item 2 below: verified, no
  change required).

The conversions live in `src/lib/discount-mode.ts` (plain module, no
`"use client"`) so the Convex mutations, the Zod schemas, the seven add/edit
forms and this renderer all share one definition of the mode union,
`resolveDiscountAmount`, and its inverse. See
[FEATUREDOCS/10](./10-projects.md#groups-projectgroup--the-billable-unit) for
the write side.

## PDF Data-Shape Consumers (audit checklist)

Any change to the `DocumentLineItem` shape (new field, new synthetic row
type, new relationship) must be verified against all consumers below —
fixing one and shipping leaves silent bugs in the others (see CLAUDE.md's
PDF footgun section for the pre-#790 history of exactly this):

1. **`gearflow-table.ts` rendering** — what gets drawn (bold, indented, etc.)
2. **`document-composer.ts`'s `calculateItemHeight`** — pagination space reservation (miss this → silent tail-drop)
3. **`document-composer.ts`'s `getFilteredParentItems`** — status filter (miss this → items disappear from docket / return-sheet)
4. **`gearflow-table.ts`'s own top-level filter** — mirrors #3, must stay in sync (documented cross-reference in both files)

A new **LayoutBlock kind** (e.g. `draftWatermark`, #987; `paymentDetails`, the
invoice payment-details block) is a different audit with two entries, not four:
`estimateBlockHeight`'s switch (miss it → the block draws over whatever follows,
or is silently dropped) and `buildEntryFields`'s switch (miss it → nothing
renders). Both are exhaustive `switch`es over `LayoutBlock["kind"]`, so
TypeScript fails the build on a missing arm — which is the point of keeping the
block union closed. `trySplitAcrossPages`/`splitRichTextBlock`'s narrower
`Extract<LayoutBlock, {...}>` union (the three free-text block kinds that can
split across pages by wrapped line) is NOT exhaustive-checked by the compiler —
`paymentDetails` had to be added there by hand alongside `clientNotes`/
`termsAndConditions`, same as `estimateBlockHeight`/`buildEntryFields`.

This is down from 5 consumers in 2 files pre-redesign (the dual pipeline
meant `section-renderer.ts` and `gearflow-table.ts` each had their own filter
+ height-estimation logic that had to be kept in sync by hand); the fixed
single pipeline collapses it to one file (`document-composer.ts`) plus the
plugin's own top-level filter.

**Real incident, #2 above (2026-07-28):** `gearflow-table.ts` grew a
sub-hire "via `<Supplier>`" line under a row's description with no matching
case added to `calculateItemHeight` — real quotes with many sub-hire lines
silently lost entire trailing categories off the rendered table (subtotal
stayed correct; the visible rows didn't). See "Sub-hire row tail-drop"
above. Concrete evidence this checklist is load-bearing, not decorative —
when a row's drawn height gains a new conditional line, add the matching
line to `calculateItemHeight` in the same change.

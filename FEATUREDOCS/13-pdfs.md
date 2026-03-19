# PDF Document Generation

## Architecture

All PDF generation uses **pdfme** (`@pdfme/generator` + `@pdfme/common` + custom plugins via `@pdfme/pdf-lib`).

### Generation Pipeline — Two Pipelines

**1. Section-Based Pipeline (new, preferred)**
1. Template has `sections` field → array of `TemplateSection` objects
2. `renderSections()` evaluates visibility → computes page layout → builds pdfme `Template` + `inputs`
3. Multi-page pagination: section heights estimated → tables split across pages → headers repeated on continuation pages
4. pdfme `generate()` renders → PDF `Uint8Array`

**2. Legacy Pipeline (fallback)**
1. Template has `basePdf` + `schemas` fields → direct pdfme template
2. `getTemplateBuilder(docType)` → hardcoded template builder
3. pdfme `generate()` renders → PDF `Uint8Array`

**Template selection**: `templateId` → org's default published template → system default. Section-based templates are preferred when available.

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/pdfme/generate-pdf.ts` | Orchestrator — dual pipeline, `loadTemplate()` with brand resolution |
| `src/lib/pdfme/section-renderer.ts` | Section-based renderer — converts `TemplateSection[]` → multi-page pdfme `Template` + `inputs` |
| `src/lib/pdfme/section-types.ts` | Section type definitions, default settings, default section lists per doc type |
| `src/lib/pdfme/condition-evaluator.ts` | Visibility condition evaluation (doc type filter + data conditions) |
| `src/lib/pdfme/token-resolver.ts` | `{token}` resolution with whitelist, `resolveTokensInText()`, `getAllowedTokens()` |
| `src/lib/pdfme/build-document-data.ts` | Assembles `DocumentData` contract for project documents |
| `src/lib/pdfme/templates/index.ts` | Template registry — maps doc types → template builders (legacy) |
| `src/lib/pdfme/templates/shared-builders.ts` | Shared helpers mapping `TemplateSettings` → plugin configs (legacy) |
| `src/lib/pdfme/template-settings.ts` | `TemplateSettings` interface + `getDefaultSettings()` per doc type (legacy) |
| `src/lib/pdfme/sample-document-data.ts` | Sample data generator for preview (real org branding + fake content) |
| `src/lib/pdfme/types.ts` | `DocumentType`, `TestTagReportType`, `DocumentData`, plugin config types |
| `src/lib/pdfme/plugins/index.ts` | Plugin registry — all custom + built-in plugins |
| `src/lib/pdfme/fonts.ts` | Font configuration for pdfme |
| `src/lib/validations/template-section.ts` | Zod schemas for sections, brand templates, export/import |

### Custom Plugins (`src/lib/pdfme/plugins/`)

**Project Document Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowTable` | Equipment table — grouping, kit children (3 levels), badges, checkboxes, conditions, per-unit expansion |
| `gearflowFinancialSummary` | Subtotal/discount/tax/total block with optional deposit/balance |
| `gearflowPageHeader` | Three modes: logo, icon, none — org info + doc title |
| `gearflowPageFooter` | Centered footer with top border |
| `gearflowCheckbox` | Empty/checked checkbox square |
| `gearflowSignatureLine` | Signature blocks with configurable columns |
| `gearflowCrewTable` | Crew table for call sheets — sorted by call time then role |

**Report Plugins:**
| Plugin | Purpose |
|--------|---------|
| `gearflowDataTable` | Generic configurable table with columns, sections, badges, expanded notes |
| `gearflowSummaryBox` | Horizontal metrics row (e.g., "Total: 42", "Compliance: 95%") |
| `gearflowTextBlock` | Multi-line text — paragraphs, key-value grids, section titles |

### Plugin Architecture
- Plugins receive `value` as JSON string, parse it, draw directly via pdf-lib
- `helpers.ts`: coordinate conversion (mm→pt, Y-flip), font caching (Helvetica/Bold/Courier), color parsing, text wrapping, formatCurrency/formatDate
- `ui` and `propPanel` are stubs (template designer visual polish is a future phase)

## Section-Based Template Builder

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
- **Server actions**: `src/server/brand-templates.ts` — CRUD, set/unset default

### Template Builder UI
| Component | File | Purpose |
|-----------|------|---------|
| `SectionBuilder` | `src/components/settings/template-builder/section-builder.tsx` | Main editor — dnd-kit reordering, undo/redo, preview, save |
| `SectionCard` | `section-card.tsx` | Draggable card with type icon, actions |
| `SectionSettingsPanel` | `section-settings-panel.tsx` | Per-type settings forms + visibility editor |
| `SectionLibrary` | `section-library.tsx` | Dialog to add new sections from catalog |

### Editor Page
- **URL**: `/template-designer/[id]`
- **Detection**: Page checks for `sections` field → renders `SectionBuilder` (new) or `TemplateEditor` (legacy)
- **Layout**: 3-panel — section list (left, 280px) + settings panel (middle, 300px) + PDF preview (right, flex)
- **Features**: drag-to-reorder, undo/redo (Cmd+Z / Cmd+Shift+Z), live preview with 600ms debounce
- **Preview API**: POST `/api/documents/template-preview` with `{ docType, sections }` body

### Template Management
- **Settings page**: `/settings/documents` — template cards grouped by doc type (tabs)
- **System defaults**: Virtual entries from `getDefaultSections()` — "Customise" creates section-based template
- **Custom templates**: Edit, duplicate, delete, set/unset default, publish
- **Export/Import**: JSON format with version, type, name, sections, exportedAt
- **Thumbnails**: Stored as base64 in `thumbnailData` column
- **Server actions**: `src/server/document-templates.ts` — `saveTemplateSections()`, `exportTemplate()`, `importTemplate()`, `duplicateSystemDefaultWithSections()`, `saveTemplateThumbnail()`

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
| `delivery-docket` | header, client-details, project-details (+ site contact), table (checkboxes, row numbers), signature (3 cols) |
| `call-sheet` | header, client-details, project-details, crew-table, notes (crew only) |

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
| `/api/documents/call-sheet/[projectId]` | GET | Generate call sheet. Params: `date` (optional), `templateId` (optional) |
| `/api/test-tag-reports/[reportType]` | GET | Generate T&T report. Params: `format` (pdf/csv), filters (dateFrom, dateTo, status, equipmentClass, etc.) |

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state uses rotated lines
- Line item notes shown as subtitles
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units

# PDF Document Generation

## Architecture

All PDF generation uses **pdfme** (`@pdfme/generator` + `@pdfme/common` + custom plugins via `@pdfme/pdf-lib`).

### Generation Pipeline
1. **API route** receives request (project ID + doc type, or report type + filters)
2. **Data assembly** loads project/report data from DB, enriches with overbooking, serializes Decimals
3. **Template selection**: specific `templateId` → org's default published template → system default from code
4. **Input builder** transforms data into JSON-stringified plugin configs
5. **pdfme `generate()`** renders template + inputs + plugins → PDF `Uint8Array`
6. **Response** streams as `application/pdf`

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/pdfme/generate-pdf.ts` | Orchestrator — `generatePdf()`, `generatePdfFromSettings()`, `generateTestTagReport()` |
| `src/lib/pdfme/build-document-data.ts` | Assembles `DocumentData` contract for project documents |
| `src/lib/pdfme/templates/index.ts` | Template registry — maps doc types → template builders |
| `src/lib/pdfme/templates/shared-builders.ts` | Shared helpers mapping `TemplateSettings` → plugin configs |
| `src/lib/pdfme/template-settings.ts` | `TemplateSettings` interface + `getDefaultSettings()` per doc type |
| `src/lib/pdfme/sample-document-data.ts` | Sample data generator for preview (real org branding + fake content) |
| `src/lib/pdfme/types.ts` | `DocumentType`, `TestTagReportType`, `DocumentData`, plugin config types |
| `src/lib/pdfme/plugins/index.ts` | Plugin registry — all custom + built-in plugins |
| `src/lib/pdfme/fonts.ts` | Font configuration for pdfme |

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

### Template Designer (Settings-Based Editor)
- **Settings page**: `/settings/documents` — template cards grouped by document type (tabs), system defaults with "Customise" button
- **Editor page**: `/template-designer/[id]` — Zoho Books-style settings editor with live PDF preview
  - Left icon nav: General, Header, Details, Table, Totals, Other
  - Settings panel: toggles, inputs, dropdowns for each section
  - Live PDF preview with real org branding + sample data, debounced regeneration (600ms)
- **Database model**: `DocumentTemplate` — stores custom templates per org with `basePdf` (JSON), `schemas` (JSON), `settings` (JSON, `TemplateSettings`), `isDefault`, `isDraft` fields
- **TemplateSettings** (`src/lib/pdfme/template-settings.ts`): User-facing config controlling all toggles — header (logo mode, org details), footer (text), details (client/project fields), table (columns, checkboxes), totals (financial lines), other (notes, signatures)
- **Settings flow**: User toggles setting → debounced POST to `/api/documents/template-preview` → renders PDF with org branding + sample data → displayed via pdf.js canvas renderer. Save persists to `DocumentTemplate.settings`. Publish makes template available for use.
- **Template builders** accept optional `TemplateSettings` — maps settings to plugin configs (backward compatible, `null` = system defaults)
- **Shared builders** (`src/lib/pdfme/templates/shared-builders.ts`): Reusable helpers mapping settings to plugin configs (header, footer, client info, project info, table, financials)
- **Sample data** (`src/lib/pdfme/sample-document-data.ts`): Loads real org branding from DB, fills realistic sample project/client/line items
- **Server actions**: `src/server/document-templates.ts` — CRUD, duplicate, publish, set/unset default, `saveTemplateSettings()`, `getTemplateForEditor()`
- **Preview API route**: `src/app/api/documents/template-preview/route.tsx` — POST endpoint returning binary PDF for live preview
- **PDF viewer**: `src/components/settings/template-editor/pdf-viewer.tsx` — Client-side PDF renderer using pdf.js canvas elements
- **Permissions**: `document.manage_templates` — owner, admin, manager roles
- **System defaults**: Virtual entries (not in DB), shown from code templates. "Customise" duplicates into org-owned template with default settings
- **Template selection priority**: `templateId` param → org's published default → system default

## Project Document Templates

6 document types with system defaults in `src/lib/pdfme/templates/`:

| Type | Template File | Page Size |
|------|--------------|-----------|
| `quote` | `quote.ts` | A4 Portrait |
| `invoice` | `invoice.ts` | A4 Portrait |
| `packing-list` | `packing-list.ts` | A4 Portrait |
| `return-sheet` | `return-sheet.ts` | A4 Portrait |
| `delivery-docket` | `delivery-docket.ts` | A4 Portrait |
| `call-sheet` | `call-sheet.ts` | A4 Landscape |

### Template Picker
- Project detail page documents dropdown queries for published custom templates
- If custom templates exist for a doc type, shows sub-menu: "Default" + each custom template
- If no customs, generates with default (org custom default or system default)
- Call sheet is always a single menu item (no template sub-menu yet)

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
| `/api/documents/template-preview` | POST | Generate template preview PDF. Body: `{ docType, settings }`. Returns binary PDF |
| `/api/documents/[projectId]` | GET | Generate project document. Params: `type` (quote/invoice/pull-slip/delivery-docket/return-sheet), `templateId` (optional) |
| `/api/documents/call-sheet/[projectId]` | GET | Generate call sheet. Params: `date` (optional), `templateId` (optional) |
| `/api/test-tag-reports/[reportType]` | GET | Generate T&T report. Params: `format` (pdf/csv), filters (dateFrom, dateTo, status, equipmentClass, etc.) |

## Constraints
- **Helvetica only** — no Unicode symbols (use ASCII: `-` not `—`, `|` not `•`)
- Checkboxes rendered as `View` boxes with borders; checked state uses rotated lines
- Line item notes shown as subtitles
- Badges: red "OVERBOOKED", purple "REDUCED STOCK"
- Pull slip: per-unit checkboxes for qty > 1 items, ticked for already-deployed units

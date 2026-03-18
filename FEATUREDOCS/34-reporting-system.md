# Detailed Reporting System

## Overview
Two-tier reporting: ~30 pre-built reports + custom report builder with save/share/pin. All reports exportable as CSV and PDF. Uses a JSON-based `ReportConfig` translated to Prisma queries by a server-side report engine.

## Data Model
- **`SavedReport`** — `id, organizationId, name, description, dataSource, config (JSON), createdById, isShared, isPinned, lastRunAt, createdAt, updatedAt`
- Indexed on `[organizationId]` and `[organizationId, createdById]`

## Report Engine (`src/lib/report-engine.ts`)
Translates `ReportConfig` → Prisma queries:
- Maps 11 data sources (assets, models, projects, kits, lineItems, clients, locations, maintenance, activityLog, crew, crewAssignments)
- Filter translation (equals, contains, gt, in, between, etc.) with nested relation support
- Date range presets (last7days, thisMonth, thisQuarter, thisYear, etc.)
- GroupBy with aggregations (count, sum, avg, min, max)
- Computed fields (_totalRevenue, _availableCount, _totalProjects, etc.) via post-processing
- Flattens nested relation data for display
- CSV export via `generateCSV()`

## Type Definitions (`src/lib/report-types.ts`)
- `ReportConfig` — columns, filters, groupBy, sortBy, dateRange, limit
- `FIELD_DEFINITIONS` — per-data-source field metadata (type, section, enum values)
- `PRE_BUILT_REPORTS` — ~30 pre-defined report configs
- `getReportsByCategory()` — groups pre-built reports by category

## Pre-Built Reports (~30)
| Category | Reports |
|----------|---------|
| Assets | Inventory, Utilisation, Model Popularity, Asset Value by Category, Warranty Expiry |
| Projects | Summary, Revenue by Client, Overdue Returns, By Location, Subhire Summary, Profitability |
| Kits | Inventory, Utilisation |
| Clients | Revenue, Top Clients |
| Maintenance | Costs by Type, Open Maintenance |
| Crew | Roster, Utilisation, Labour Cost by Project, Freelancer Spend |
| Operations | Activity Log, Location Summary |

## Routes
| Route | Description |
|-------|-------------|
| `/reports` | Dashboard with quick stats + report library + saved reports |
| `/reports/builder` | Custom report builder (data source → columns → filters → grouping → sort → preview → save) |
| `/reports/builder/[id]` | Edit existing saved report |
| `/reports/[id]` | View/run a saved report |

## Permissions
- `reports: view` — run reports (all roles)
- `reports: export` — CSV export (owner, admin, manager)
- `reports: create` — save custom reports (owner, admin, manager)
- `reports: delete` — delete saved reports (owner, admin, manager)

## Server Actions (`src/server/reports.ts`)
- `getReportsSummary()` — dashboard quick stats
- `runReport(config, page, pageSize)` — execute report, returns paginated results
- `runReportCSV(config)` — execute and return CSV string
- CRUD: `saveReport`, `updateSavedReport`, `deleteSavedReport`, `getSavedReports`, `getSavedReportById`
- `togglePinReport(id)` — pin/unpin
- `updateReportLastRun(id)` — track last execution

## Components
- `ReportViewer` — table display with pagination, aggregation summary, CSV + PDF export; opens in wide-screen dialog with auto-run
- `ReportBuilder` — step-by-step builder (data source → columns → filters → grouping → sort → preview → save)

## Validation (`src/lib/validations/report.ts`)
- `reportConfigSchema` — validates ReportConfig JSON
- `saveReportSchema` — name, description, dataSource, config, isShared, isPinned

## PDF Export
- **API Route**: `POST /api/reports/pdf` — accepts `{ config, title, subtitle }`, returns PDF
- **Template**: `src/lib/pdfme/templates/report.ts` — landscape A4, multi-page with row chunking
- **Generator**: `generateReportPdf()` in `src/lib/pdfme/generate-pdf.ts`
- Uses `gearflowPageHeader`, `gearflowSummaryBox`, `gearflowDataTable`, `gearflowPageFooter` plugins
- Org branding (logo, colors) applied automatically
- **Multi-page**: pdfme renders all schema pages per input object, so unique field names per page (`header_0`, `dataTable_0`, `header_1`, `dataTable_1`, etc.) with a single input object containing all page data
- **Summary box**: auto-wraps to multiple rows (max 5 items per row), labels resolved from `FIELD_DEFINITIONS`
- **Header title**: auto-scales font size to fit within 55% of header width
- Page 1 layout adapts dynamically to summary box height (more aggregations = taller summary = fewer data rows)

## Integration
- **Org Export/Import**: SavedReport included in transfer types, export, and import
- **Activity Log**: Create/update/delete of saved reports logged
- **Page Commands**: Reports + Custom Report Builder entries
- **Top Bar**: Segment labels for reports and builder

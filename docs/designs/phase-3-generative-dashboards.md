# Phase 3: Generative Dashboards — Design Doc

## Overview

Mira (the AI agent) can now create persistent dashboard pages on demand, inspired by Improvado's describe → generate → persist → refine flow. Users say "Make a dashboard for Q3 email" and get a real, navigable, shareable page — not a chat response.

## Architecture

```
User / Mira says "Make a dashboard for Q3 email"
  → Dashboard Generator (server action or Mira tool)
    → Creates Dashboard record + WidgetInstance[] records in DB
  → /dashboards/[id] page route renders DashboardCanvas
    → DashboardCanvas reads dashboard + widgets from DB
    → Renders grid with MetricCard, Chart, Table, InsightCard widgets
  → New dashboard auto-pins in sidebar under "Dashboards" section
```

## Data Model

Two new Prisma models:

### Dashboard
- `id` String @id @default(cuid())
- `organizationId` String (FK → Organization)
- `title` String
- `description` String?
- `layout` String (JSON: grid column count, gap, etc.)
- `createdAt`, `updatedAt`
- `createdById` String? (FK → User)

### WidgetInstance
- `id` String @id @default(cuid())
- `dashboardId` String (FK → Dashboard, onDelete: Cascade)
- `type` WidgetType (enum: METRIC_CARD, CHART, TABLE, INSIGHT_CARD)
- `title` String
- `config` String (JSON: per-type config — query params, chart type, columns, etc.)
- `dataSource` String (JSON: query definition — entity, metric, filters, dateRange)
- `width` Int (grid columns, 1-4)
- `height` Int (grid rows, 1-4)
- `positionX` Int
- `positionY` Int
- `createdAt`, `updatedAt`

No "Document" / "Vault" table — dashboards are their own first-class models. This keeps widget placement and dashboard queries simple without needing a generic document system.

## Page Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/dashboards` | `DashboardListPage` | Shows all dashboards for the org in a card grid |
| `/dashboards/[id]` | `DashboardViewPage` | Renders the dashboard canvas |
| `/dashboards/[id]/edit` | `DashboardEditPage` | Edit mode — reposition, resize, remove widgets |

## Component Tree

```
Sidebar
  └── Dashboards section (auto-pinned, one entry per dashboard)
      └── "New Dashboard" button (opens Mira prompt dialog)

/app/dashboards/page.tsx
  └── DashboardListPage
      └── DashboardCard[] (thumbnail, title, description, link)

/app/dashboards/[id]/page.tsx
  └── DashboardViewPage
      └── DashboardCanvas
          └── DashboardGrid (CSS grid with widget placements)
              ├── MetricCard (big number + label + trend)
              ├── ChartWidget (bar/line/pie using shadcn chart + recharts)
              ├── TableWidget (data table with columns)
              └── InsightCard (text insight + icon)

/app/dashboards/[id]/edit/page.tsx
  └── DashboardEditPage
      └── EditableDashboardCanvas
          └── DraggableResizableWidget[] (react-grid-layout or custom)
```

## Widget Library

### MetricCard
- Big number display with label
- Optional trend indicator (up/down arrow + % change)
- Optional sparkline
- Color-coded by intent

### ChartWidget
- Backed by shadcn/ui chart components (recharts)
- Types: Bar (vertical/horizontal), Line, Pie, Area
- Configurable colors
- Legend, tooltips

### TableWidget
- Data table with sortable columns
- Entity-specific columns based on dataSource
- Row count limit

### InsightCard
- Text insight with an icon
- Color-coded severity/intent
- Optional small data table

## Server Actions

Located in `src/server/dashboards.ts`:

- `getDashboards()` → Dashboard[] with widget counts
- `getDashboard(id)` → Dashboard + WidgetInstance[]
- `createDashboard(input: { title, description, layout?, widgets? })` → Dashboard
- `updateDashboard(id, input)` → Dashboard
- `deleteDashboard(id)` → void
- `createWidget(dashboardId, input)` → WidgetInstance
- `updateWidget(id, input)` → WidgetInstance
- `deleteWidget(id)` → void
- `reorderWidgets(dashboardId, placements[])` → void (batch update positions)

### Mira Tool (Generator)

- `generateDashboard(description: string)` → Promise<{ dashboard: Dashboard, widgets: WidgetInstance[] }>
  - Takes a natural language description
  - Uses the current org context to generate relevant dashboard data
  - Creates dashboard + widgets in a transaction
  - Returns the created entities

## Sidebar Integration

- New "DASHBOARDS" section in the sidebar (between CORE and ASSETS)
- "New Dashboard" button at the top that opens a dialog with a Mira prompt
- Each dashboard appears as a sidebar item under the section
- Auto-pins new dashboards
- Pin/Unpin control per dashboard

## Permissions

Add "dashboard" to the RESOURCES array in `src/lib/permissions.ts`:
- Actions: read, create, update, delete
- Default: admin/manager have all, member/staff have read + create, viewer has read

## Implementation Order

1. Prisma schema + migration (Dashboard + WidgetInstance models)
2. Widget library components (MetricCard, ChartWidget, TableWidget, InsightCard)
3. Dashboard canvas + grid layout
4. Server actions (CRUD for dashboards + widgets)
5. Dashboard view page `/dashboards/[id]`
6. Dashboard list page `/dashboards`
7. Dashboard editor `/dashboards/[id]/edit`
8. Sidebar integration (Dashboards section, auto-pin)
9. Mira dashboard generator tool
10. New Dashboard button + dialog
11. FEATUREDOCS documentation

## Key Decisions

1. **No vault dependency** — Dashboards are standalone Prisma models, not stored in a generic document system. This avoids coupling to Phase 4 and keeps the schema simple.
2. **CSS grid for layout** — `display: grid` with explicit x/y/w/h on widgets. Simple, fast, no extra dependency for view mode. The editor uses a simple drag-to-move interaction (react-grid-layout if added, or a custom drag with CSS grid).
3. **JSON config** — Widget type, config, and dataSource are all JSON columns. This keeps the schema stable while allowing any widget type to have arbitrary configuration.
4. **Server-side queries** — Widget dataSources are evaluated by server actions, not client-side. This gives full Prisma query power and keeps auth rules in place.
5. **No chart library yet** — Use shadcn/ui chart components (@/components/ui/chart) which wraps recharts. Install recharts + @radix-ui/react-tabs as dependencies.
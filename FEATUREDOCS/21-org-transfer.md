# Organization Export/Import

> GearFlow is single-tenant operationally, but org export/import is also the
> production backup-and-restore path. New tables MUST be added here or backups
> silently lose data.

## Export (`src/lib/org-export.ts`)
- Queries all org-scoped tables — currently covers identity/auth, assets,
  kits, projects, line items, suppliers, supplier orders, maintenance,
  test & tag, media, saved reports, **crew (members/roles/skills/skill links/
  certifications/assignments/shifts/availability/time entries), check items
  (library + model links + kit links + records), and group templates**
- Builds streaming ZIP via `archiver`: `manifest.json` + `files/{storageKey}`
- Concurrent S3 downloads limited to 5
- API: `GET /api/admin/org-export/[orgId]` (site admin only)

## Import (`src/lib/org-import.ts`)
- Extracts ZIP via `unzipper`
- Creates new org with full ID remapping (`@paralleldrive/cuid2`)
- Topological sort (BFS) for hierarchical tables (Category, Location, ProjectLineItem parentId)
- User FKs resolved by email matching — unmatched users are skipped gracefully
- S3 files re-uploaded under new org prefix; `thumbnailUrl` cleared
- Image URL references (`model.image`, `kit.image`, etc.) updated via URL mapping
- `safeDate()`/`safeDateOpt()` handle invalid dates
- SupplierOrders imported after Projects (due to projectId FK)
- Crew imported in dependency order (roles + skills, then members, then
  skill links via implicit m:n join, then certifications, assignments,
  shifts, availability, time entries). `icalToken` and assignment
  `responseToken` are cleared to avoid unique-constraint collisions with
  the source org.
- Check records skip silently if `performedById` (required) can't be remapped
- API: `POST /api/admin/org-import` (FormData with file + optional name/slug)

## Type Definitions
`src/lib/org-transfer-types.ts` — `OrgExportManifest` interface, `MANIFEST_VERSION = 1`

## UI
- Export button on org detail page + per-row download button
- Import button + dialog on org list page

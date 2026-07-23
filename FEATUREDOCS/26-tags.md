# Universal Tags System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Most major entities support free-form string tags stored as an `tags: v.optional(v.array(v.string()))`
field on their Convex table (`convex/schema.ts`) — not a Postgres array anymore.

## Tagged Entities
`categories`, `models`, `assets`, `bulkAssets`, `kits`, `locations`,
`maintenanceRecords`, `projects`, `clients`, `suppliers`, `crewMembers` all
carry a `tags` field. Note: `getOrgTags` (autocomplete, below) currently
unions only 9 of these — `suppliers` and `crewMembers` have the field but
aren't scanned for the org-wide autocomplete list; their own tags still
render/filter fine on their entity's own UI, they just won't show up as
autocomplete suggestions elsewhere. Check `convex/tags.ts` before relying on
this for a new surface.

## Tag Normalization
Tags normalized to lowercase on save. Case is not preserved.

## Convex
- **`getOrgTags`** (`convex/tags.ts`): Browser-callable query — returns the
  distinct union of `tags` across models/assets/bulkAssets/kits/locations/
  categories/maintenanceRecords/projects/clients for autocomplete. One-shot
  fetch on mount/org-change (`useOrgTags`), not a reactive subscription —
  don't wire it as one.
- All entity `*Writes.ts` create/update mutations accept `tags` in their args.

## Global Search
`convex/globalSearch.ts` matches tags in-JS via a shared `matchesQuery`
helper's `tags` param (not raw SQL — there's no Postgres tags column left to
query against).

## UI
- **TagInput** (`src/components/ui/tag-input.tsx`): Input with badge display, autocomplete, keyboard navigation.
- **Tables**: Tags shown as `Badge variant="secondary"`, hidden on small screens.

## CSV/Export
Tags exported as semicolons; import parses them back with lowercase
normalization. Tags export/import automatically with parent entity in org
transfer (`convex/orgExport.ts`).

## Validation
All Zod schemas include `tags: z.array(z.string()).default([])`.

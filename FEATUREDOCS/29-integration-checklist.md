# Integration Checklist for New Features

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

When implementing a new feature, ensure it integrates with ALL existing systems.

| System | What to Do |
|--------|-----------|
| **Convex write** | New domain entity → Convex table in `convex/schema.ts` + `<domain>Writes.ts` mutations, NOT a Prisma model or server action. Every public mutation: `assertWritesEnabled` → `enforceBrowserWriteLimit` → `requireOrgPermission` → `resolveActor`. See FEATUREDOCS/28 and FEATUREDOCS/54. |
| **Permissions** | Add resource to `src/lib/permissions.ts` (RBAC map used by both `requirePermission()` server-action carve-outs and Convex's `requireOrgPermission`). |
| **Sidebar** | Add nav item to `src/components/layout/app-sidebar.tsx` with `resource` for gating. Exception: a **personal-scope** page (the user's own data, not an org resource — e.g. `/my-tasks`) omits `resource` entirely rather than gating on an unrelated resource; that avoids the fail-open gating flash and keeps the item visible to every role regardless of their org-resource permissions. Sidebar-only items are NOT automatically mirrored into `mobile-nav.tsx` — that file is deliberately capped at the 5 daily-operator workflows (DESIGN.md §16); check DESIGN.md before adding anything there. |
| **Top bar** | Add segment label to `segmentLabels` in `src/components/layout/top-bar.tsx`. |
| **Search** | Add entity search to `convex/globalSearch.ts`. Add to both `typeMap` objects and `typeIcons`/`typeLabels`/`pageIcons` in `src/components/layout/command-search.tsx`. |
| **Page commands** | Add to `PAGE_COMMANDS` in `src/lib/page-commands.ts` for @ navigation. |
| **Notifications** | Add time-based alerts in the relevant `convex/*.ts` domain module if applicable — `src/server/notifications.ts` is the email/delivery carve-out only, not where new alert logic goes. |
| **Dashboard** | Add stats/activity to `convex/dashboardStats.ts` / `dashboardActivity.ts` / `dashboardLists.ts`, and bump `convex/dashboardCounters.ts` in-mutation if the write is counted there. |
| **Templates** | If querying projects, add `isTemplate: false` filter. |
| **Mobile** | Responsive tables, touch targets, text wrapping (`break-words min-w-0`). |
| **Safe areas** | Full-screen mobile dialogs need safe area padding via `style` prop. |
| **Org scoping** | Every Convex query/mutation MUST check `organizationId` — `by_cuid`/`by_modelId`-style indexes are global, so re-check the row's org even after a permission check (FEATUREDOCS/54). |
| **Serialization** | Server-action carve-outs still `serialize()` return values; Convex functions declare a `returns` validator instead. |
| **Validation** | Zod schema in `src/lib/validations/`. Use `z.input<>` for form types. Reuse the same schema in the write hook's `.parse()` call. |
| **Tags** | If entity has a Convex `tags` array field, add `TagInput` to form, a tags column to the table, and check whether `convex/tags.ts`'s `getOrgTags` needs to scan the new table too. |
| **Activity Log** | Browser-direct mutations write their own audit row in-mutation (`writeActivityLog` from `convex/lib/audit.ts`) and skip `logActivity()`; server-action carve-outs call `logActivity()` from `src/lib/activity-log.ts` (which itself writes to Convex — see FEATUREDOCS/24). |
| **Media** | If entity has photos, add a `{entity}Media` table in `convex/schema.ts` + `MediaUploader`. |
| **CSV** | Consider import/export if bulk data operations are useful. |
| **Org export** | Classify the new table as DIRECT/FILTER/PARENT_JOIN/EXCLUDED in `scripts/org-export-tables.ts` and bump `EXPECTED_TABLE_COUNT` (check the CURRENT value first — don't assume a stale baseline; `convex/orgExport.ts`'s generic readers don't need per-table edits, only this classification file does). See WS6 #945's `serviceSchedules` addition (DIRECT, 100 → 101) for a worked example. |
| **Documentation** | Update ARCHITECTURE.md overview and add/update relevant FEATUREDOCS file. |
| **Role-gated fields** (WS10 #949) | If a field must be hidden from some roles (e.g. cost/margin data manager+ only), don't strip it in the shared list query other call sites depend on — add a SEPARATE query for the gated surface (see `crewRoles.ts` `listForSettings` vs `list`) and redact with `redactFields()` (`convex/lib/auth.ts`) based on `isCallerManagerPlus()`/`isManagerPlusRole()` (`convex/lib/permissionsCore.ts` — the one source of truth, shared with the client-side `useIsManagerPlus()` hook). Client-side hiding alone is not sufficient (R-9.3). |

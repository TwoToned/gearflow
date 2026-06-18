# RVLT Flow — full polish sweep tracker

Goal: every page, tab, flow polished to the RVLT design language (DESIGN.md authority +
preview-v2 aesthetic), informed by proven patterns (Linear/Notion/Airtable/ServiceTitan/
Jobber/Stripe + Mobbin where available). Functionality preserved. Commit per chunk;
independent Claude + Codex review per chunk; fix findings; commit.

## Polish rubric (apply to every surface)
- Tokens only — no raw hex / Tailwind palette; hard-offset shadows (`--sh-*`), no blur
- Sentence case everywhere (§5.2); type on the 11/12/13.5/14/15/16/18/24/38 ramp, 11px floor
- §9.1 on every hand-built control: `focusRing`, `disabledState`, `motion-safe:` guards
- Status via `status-colors.ts`; §1 red(live) vs t-out(problem); §3.7 on-fill text
- Personality §9: Kalam/mascot/irreverence only in empty/zero/positive; never in alert/overdue
- Required states §8: empty / loading (skeleton) / error / auth-gated per surface type
- Layout templates: PageHeader, breadcrumbs, 2-col detail (63/37), flat form sections
- Mobile §15/§16: 44px targets, safe-area insets, card lists, no 3+ col grids
- Proven UX per surface (information hierarchy, interaction patterns)

## Chunks & status  (☐ todo · ◐ in progress · ✅ done+reviewed)

| # | Chunk | Surfaces | Status |
|---|-------|----------|--------|
| 0 | App shell & global | sidebar, mobile-nav, user-nav, layouts, top-bar | ✅ |
| 1 | Dashboard | dashboard, my-work-section | ✅ |
| 2 | Projects list + create | board, table, view-toggle, wizard, range-calendar | ✅ |
| 3 | Projects detail + tabs | projects/[id], equipment-tab, crew/services/costs/tasks/managers panels, runsheet, edit, templates | ✅ |
| 4 | Assets | registry list/detail/new/edit, models (+[id]/new/edit), categories, asset/model-checks tabs | ✅ |
| 5 | Kits | list/detail/new/edit, kit-checks tab | ☐ |
| 6 | Crew | list/detail/new/edit, planner, timesheets | ☐ |
| 7 | Warehouse | list, [projectId] (deploy/pick-prep/return/close-out/bulk-checkin tabs), pull-sheet, check/[assetTag] | ☐ |
| 8 | Clients & Suppliers | clients list/detail/new/edit, suppliers (+orders/new) | ☐ |
| 9 | Locations | list/detail/new/edit | ☐ |
| 10 | Maintenance | list/detail/new/edit | ☐ |
| 11 | Test & Tag | t&t list/[id]/new/quick-test/registry/reports | ☐ |
| 12 | Availability + Activity + Changelog + Notifications | those 4 + account, account/notifications | ☐ |
| 13 | Settings | settings + ~17 sub-pages + layout | ☐ |
| 14 | Admin | admin, organizations(+[id]), settings, users, layout | ☐ |
| 15 | Auth (marketing aesthetic §17) | login, register(+admin), onboarding, invite, no-org, pending-approval, two-factor, layout | ☐ |
| 16 | Edge/standalone | offline, auditor/[token], warehouse/display/[token], root marketing page | ☐ |

## Review log
(per-chunk: Claude verdict + Codex verdict + fixes applied)

### Chunk 3 — Projects detail (review fixes applied)
Applied the merged Claude + Codex design-review fix list for the detail chunk:
- New `service` StatusCategory in `status-colors.ts` (ServiceStatus enum →
  intents); services-panel + runsheet service indicators rewired to
  `category="service"` with the raw uppercase value (stopped lowercasing),
  SERVICE_STATUS_LABELS kept as the label source. Crew-assignment indicators
  (ca.status) stay `category="assignment"` — that's AssignmentStatus, correct.
- Hand-rolled crew avatars (services-panel crew stack + combobox icon, tasks-panel
  assignee) replaced with `PersonAvatar`; removed sub-floor text-[8/9/10px] initials,
  bumped the +N overflow chip off the 9px floor.
- Crew-panel conflict/warning notices → surface bg + 3px left-edge bar (DESIGN
  Notices/Alerts) instead of full soft tint.
- Runsheet wrapped in `RequirePermission resource="project" action="read"`;
  sticky header backdrop-blur → solid `bg-paper`.
- §5.2 sentence-case sweep across page/templates/crew/equipment/services/runsheet/
  managers literals; equipment-tab service-type chip mapped through SERVICE_TYPE_LABELS.
- Type ramp: off-ramp text-sm/text-xs → text-ui-text/text-caption in services-panel,
  tasks-panel, runsheet.
- Task priority no longer colour-only (§3.3): dot aria-label/title + visible High/Low
  caption (Normal = default, dot only).
- Templates page: PageHeader component + left-edge red query-error notice w/ retry.
- project-managers-panel remove button gains `disabledState`.
Left as-is per review judgment: project-costs-panel MarginBar threshold colours
(threshold viz), org role-color chips (data-driven accent, out of rubric).
tsc + eslint clean on touched files (only pre-existing form.watch/unused-import warnings).

### Chunk 4 — Assets (polished, pending review)
Swept all 14 surfaces (registry list/detail/new/edit, models list/detail/new/edit,
categories list/detail, asset-form, bulk-asset-form, asset/model-checks tabs). Also
repaired the registry-refresh breakage these files carried (all type-errored before):
`Badge variant=` → `Badge status`; `Button variant="outline"+render=` →
`variant="line"+asChild`; `DialogClose render=` → `asChild`; `EmptyState`
old `preset/heading/action-object` API → new `title/description/action-node` API
(the old props were silently ignored). Legacy tokens (`text-fg*`, `bg-bg-surface`,
`surface-ring`, raw palette colours) migrated to RVLT tokens; status via
status-colors; §1 red(live)/t-out(problem) applied to destructive actions and form
errors; §9.1 focusRing/disabledState added to all hand-built controls (reorder
buttons, picker rows, breadcrumb/table links); skeleton loading replaced spinners;
sentence case + 11px floor enforced; placeholder folder emoji replaced with Lucide
icons (user-set category icons preserved). tsc + eslint clean (only pre-existing
form.watch/unused-import warnings).

**Chunk 4 supporting components (follow-up):** the components rendering on the
assets pages (`asset-table`, `model-table`, `asset/model-accessories-manager`,
`asset-qr-code`, `category-manager`, `csv-import-dialog`, `model-failure-analytics`,
`model-form`, `specifications-editor`) had regressed against the refreshed registry
(41 tsc errors total). Migrated: `Button variant="outline"+render=` →
`variant="line"+asChild`; `Badge variant=secondary/default/outline` → status-only
`Badge status="neutral"` (type-as-status pills are neutral); `DialogTrigger/DialogClose
render=` → Radix `asChild`; Radix `Checkbox indeterminate` boolean →
`checked="indeterminate"`. Tables: left-edge red hover already via DataTable; t-mono
on tags/serials, t-data tabular-nums on counts/rates, status filter dots + utilization /
failure bars via status-colors (red=live/threshold, warn=at-risk, ok=available — §3
data-viz red-is-threshold). §9.1 focusRing/disabledState on hand-built view-toggle,
bulk-edit selects, picker rows, rate-suggestion links. §5.2 sentence case + dropped
uppercase section/category labels; 11px floor (sub-floor 10px tags → text-badge).
Skeleton loading replaced all spinners; CSV-import result → left-edge accent notice
(plain copy, §9 no personality in import-failure). Folder placeholder emoji → Lucide
FolderOpen (user icons kept). Forms aligned to swept asset-form container/select; links
use text-link (blue, § links-never-red). tsc clean (0 assets errors), eslint clean
(only pre-existing model-form unused Select-import + form.watch warnings).

**Chunk 4 — review fixes applied (merged Claude + Codex):**
- Auth gates (§8): wrapped registry/new (asset.create), registry/[id]/edit
  (asset.update — EditLockGate isn't authz), models/new (model.create),
  models/[id]/edit (model.update), categories list + [id] detail (model.read —
  the resource getCategories/getCategory's mutations require; their reads are
  org-scoped) in `RequirePermission`. Hoisted the existing model.read gate on
  models/[id] above the loading / not-found branches (was below → unauthorised
  users saw a misleading not-found).
- Danger-button on-fill (§3.7/§1): asset Delete escalates to solid red
  (`hover:bg-red hover:text-white`); Force return + Archive (model + asset)
  stay tinted (`text-warn hover:bg-warn-soft` / `text-t-out hover:bg-out-soft`).
  Removed the theme-fragile `hover:bg-t-out/warn hover:text-paper` introduced by
  the polish.
- Status colours from source (§3): asset-table status/condition/bulk filter dots
  + Utilization inline text now read getStatusColor(...).dot/.text; model-table
  TYPE_COLORS span replaced with `<Badge status>` + TYPE_STATUS map (mirrors
  model-checks-tab); asset-checks-tab result-icon tint reads intentStyles.
- Error state (§8): categories/[id] now renders a left-edge red error notice
  (back + retry) distinct from not-found.
- §5.2: "Pass / Fail" → "Pass / fail"; "Ad Hoc" → "Ad hoc". Minor: inherited-
  accessory caption → text-badge text-muted; categories skeleton rounded-[8px] →
  rounded-[var(--r)].
- DEFERRED (cross-cutting, dedicated responsive-table pass): hand-built overflow
  sub-tables on registry/[id], models/[id], categories/[id] lack mobile card
  lists + left-edge red row hover. Not addressed here.
tsc clean (0 new assets errors; pre-existing settings/assets `variant="outline"`
errors are out of chunk-4 scope), eslint clean on touched files (only pre-existing
registry/[id] unused-import + ternary-await warnings).

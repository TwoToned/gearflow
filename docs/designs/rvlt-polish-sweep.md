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
| 5 | Kits | list/detail/new/edit, kit-checks tab | ✅ |
| 6 | Crew | list/detail/new/edit, planner, timesheets | ✅ |
| 7 | Warehouse | list, [projectId] (deploy/pick-prep/return/close-out/bulk-checkin tabs), pull-sheet, check/[assetTag] | ◐ |
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

### Chunk 7 — Warehouse (polished, pending review)
Swept all warehouse + check surfaces — the operator scan/check-out/check-in
heart of the app. All files type-errored against the refreshed registry before
(75 tsc errors in scope → 0). Functionality (scan logic, mutations, check
queues, kit verification) untouched: markup/className/type-level swaps +
additive auth gate + status-colors only.

Surfaces: warehouse landing (`page.tsx`), per-project flow
(`[projectId]/page.tsx`) + all five tabs (pick-prep / deploy / return /
bulk-checkin / close-out) + shared `item-check-form`, `kit-child-rows`,
`prep-status-badge`, `online-pick-list`; `pull-sheet/page.tsx`;
`check/[assetTag]/page.tsx`.

Registry API repairs: `Button variant="outline"/"destructive"/"secondary" +
render=` → `"line"/"primary" + asChild`; `size="icon-sm"` → `"icon"`;
`Badge variant=outline/secondary` + Tailwind-palette classes → status-only
`Badge` (ok/warn/overbooked/neutral) — blue "info"/sub-hire/reduced-stock
pills are a `bg-blue-soft text-blue` override on a neutral pill (Badge has no
info status); `Checkbox indeterminate` boolean → `checked="indeterminate"`;
`EmptyState` old `icon/heading` API → `title/description`; `TooltipTrigger
render=` → `asChild`.

RVLT polish: legacy `text-fg-*`/`bg-bg-surface`/`surface-ring`/`bg-bg-inset`/
`bg-accent`/`destructive`/`green-500`/`amber-500`/`teal`/`cyan` → ink/muted/
faint, `bg-card ring-1 ring-line shadow-[var(--sh-card)]`, bg-paper-2, bg-elev,
status tokens (ok/warn/t-out/blue). `t-mono` on asset tags, `tabular-nums` on
all counts/qty (high-speed scannable lists). §1 danger pattern: permanent
close-out (single + batch) → `variant="line"` escalating to solid red;
reversible deprep stays a neutral line. §9.1: `focusRing` + `aria-pressed` +
`min-h-11` on every hand-built control (kit-verify toggles, pass/fail +
return-condition buttons, container-clear, +Add notes, native condition
`<select>`, pick-list rows, clear-all). §8: Skeleton loaders (no spinners),
EmptyState empties, left-edge error notices for not-found, Button `loading`
prop on submits. §9 personality: close-out / pending / fail-check notices kept
plain (alert contexts). §5.2 sentence case across tab labels, doc menu,
dialogs, badges, container headers (dropped uppercase), submit/context labels,
exceptions status map. Added `RequirePermission resource="warehouse"
action="read"` gate to pull-sheet (was ungated; hoisted above loading/
not-found). StatusIndicator `pill` variant kept as-is (status-colors tokens
correct); its `dot`-variant ring-glow is a pre-existing shared-component gap
(33 consumers, out of scope) but unused here.

DEFERRED (recurring, final consistency pass): the not-found notices are simple
left-edge bars (matches the §8 recurring-DEFER guidance).

tsc clean (0 warehouse+check errors), eslint clean on touched files
(only pre-existing `Container` unused-import + `react-hooks/*` ref/exhaustive
warnings in `[projectId]/page.tsx`). 21/21 warehouse unit tests pass.

### Chunk 7 — Warehouse (review fixes applied: mobile + a11y + §5.2)
Applied the merged Claude + Codex chunk-7 fix list — the mobile-critical
operator scan surface:
- **§15 44px touch targets** on hand-built scan controls: kit-verify toggles
  (kit-child-rows), deploy container-remove icon button, item-check-form
  "+ Add notes" link, online pick-list "Clear all checks" — icon buttons get
  `min-h-11 min-w-11 inline-flex` centering, text buttons `min-h-11 px-3`;
  focusRing preserved.
- **§15 mobile card lists** (the big one): deploy / pick-prep / return /
  bulk-checkin tab tables are now `hidden md:block`, with an ADDITIVE
  `md:hidden` card list rendering the SAME grouped data + SAME selection /
  expand / verify / count handlers and mutations. New shared `scan-card.tsx`
  primitives (ScanItemCard / ScanGroupCard / ScanVerifyCard /
  ScanContainerHeading) stack item name, mono asset tag, qty and status badge
  at ≥44px; `MobileKitChildCards` (kit-child-rows) mirrors `KitChildRows`. No
  data/logic/handler/prop changes.
- **§9.1 a11y row expander**: the per-project `renderGroupHeader` row + the
  kit-group rows in all three tabs + the nested-kit row in kit-child-rows are
  keyboard-operable (`role="button"`, `tabIndex={0}`, `aria-expanded`,
  Enter/Space, focusRing); `hover:bg-accent/50` → `hover:bg-elev`.
- **§8 skeleton**: item-check-form loading `Loader2` spinner → registry
  `Skeleton` rows shaped like the check-item cards.
- **type ramp**: item-check-form `text-sm` → `text-ui-text` on notes /
  measurement inputs + dropdown trigger.
- **§5.2 sentence case**: ON_SITE "On Site" → "On site" (landing / per-project
  / pull-sheet); "Pick List" → "Pick list"; pull-sheet "Asset Tag" → "Asset
  tag"; landing "Mark as Deployed?/Returned?/Completed?" → sentence case.
- **§5 print exception (LEFT, documented)**: the pull-sheet `print:*-red-*` /
  `print:*-blue-*` overbooked/subhire literals are NOT swapped to theme tokens.
  Default theme is dark espresso with no `@media print` theme override, so
  `print:text-t-out` / `print:border-line` would resolve to the active theme's
  pale-coral / near-invisible-cream values on white paper. The literal mid-red/
  -blue are theme-independent and chosen for B/W print fidelity. Added an
  in-file comment.
tsc clean (0 warehouse+check errors), eslint clean on touched files (only the
pre-existing `Container` unused-import + `react-hooks/*` ref/exhaustive
warnings). 21/21 warehouse unit tests pass.

## Learned standard patterns (from chunk reviews — apply to ALL remaining chunks)
- **Auth-gate every page** (§8): create→`RequirePermission resource action="create"`, edit→`action="update"`,
  list & detail→`action="read"`. Resources: asset, bulkAsset, model, kit, project, client, crew, supplier,
  location, maintenance, test/tag, etc. Categories gate under `model`. Hoist the gate ABOVE loading/not-found.
- **Danger/warn button pattern** (§1/§3.7): destructive *permanent* (Delete) → `variant="line"` escalating to
  SOLID red `hover:bg-red hover:text-white` (white-on-red is the one §1 exception). Warn/reversible (Archive,
  Force return, Cancel) → stay TINTED: `text-warn hover:bg-warn-soft` or `text-t-out hover:bg-out-soft`.
  NEVER a solid `bg-warn`/`bg-t-out` fill, and never light text on a warn/t-out fill. (`text-paper` is dark
  espresso so it's not a contrast bug, but solid t-out/warn fills break §1's "t-out/warn = tinted" rule.)
- **Loaders/motion** (§9.1): prefer the registry Button `loading` prop; otherwise `motion-safe:animate-spin`.
  Use `<Skeleton>` (registry, already motion-safe) for loading states — never hand-built `animate-pulse` blocks.
- **Status filter dots**: derive from `getStatusColor(category, value).dot` — never hardcode even semantic
  tokens (bg-ok/bg-warn/…) in filterOptions; keep status-colors.ts the single source.
- **Sentence case in label MAPS too** (§5.2): typeLabels/statusLabels/option arrays often hide title case
  ("Asset Tag","Pass / Fail","Bump In","Purchase Date") and raw enum copy ("AVAILABLE") — sweep these.
- **Forms**: a SINGLE outer card surface wrapping flat `FormSection`s is CORRECT (matches FormPageLayout).
  "No card wrapping" means no card PER SECTION — do not strip the single outer surface.
- **`text-[16px]`** on native selects is the on-ramp iOS-zoom idiom — acceptable (or use `text-reading-body`).
- **Recurring DEFERs** (handle in a final consistency pass, note don't fix per-chunk): detail-page hand-built
  overflow sub-tables → mobile card lists + left-edge hover; bare "not found" → §8 left-edge error notice;
  DataTable ignores `emptyPreset` (shared component) so list empty states need explicit emptyTitle/description.

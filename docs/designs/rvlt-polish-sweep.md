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
| 7 | Warehouse | list, [projectId] (deploy/pick-prep/return/close-out/bulk-checkin tabs), pull-sheet, check/[assetTag] | ✅ |
| 8 | Clients & Suppliers | clients list/detail/new/edit, suppliers (+orders/new) | ✅ |
| 9 | Locations | list/detail/new/edit | ✅ |
| 10 | Maintenance | list/detail/new/edit | ✅ |
| 11 | Test & Tag | t&t list/[id]/new/quick-test/registry/reports | ◐ |
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

### Chunk 8 — Clients & Suppliers (polished, pending review)
Swept all 11 surfaces (clients list/detail/new/edit, client-table/client-form/
quick-create-client; suppliers list/detail/new/edit, orders/new, supplier-table/
supplier-form). All scope files type-errored against the refreshed registry before
(24 tsc errors in scope → 0). Functionality untouched: markup/className/label +
type-level registry swaps + additive auth gates/error states only.

Registry API repairs: `Badge variant=default/destructive/secondary` → status-only
`Badge status="ok"/"overbooked"/"neutral"` (active→ok, archived→overbooked,
tag/type pills→neutral); `Button variant="outline" + render=` → `variant="line" +
asChild`; `EmptyState` old `preset/heading/description` API → `title/description`
(old props were silently ignored → no empty-state copy rendered before).

RVLT polish: legacy `text-fg*`/`bg-bg-surface`/`surface-ring`/`text-destructive`/
`font-mono`/`text-sm`/`text-xs` → `ink`/`muted`/`ink-2`, `bg-card border border-line
shadow-[var(--sh-card)]`, `t-mono`/`t-data` (mono on order #/PO #/asset tag/account #,
tabular-nums on counts/qty/money/discount), `text-caption text-t-out` form errors +
`aria-invalid`. Status filter dots (client-table type filter) derived from
`getStatusColor("clientType", …).dot` (was hardcoded bg-blue-500/amber-500/green-500).
Supplier-detail asset-status `Badge variant=outline` → `StatusIndicator category="asset"`
pill (proper status-colors mapping). §9.1 `focusRing` on all hand-built links (table
name links, breadcrumb links, contact mailto/tel/website, project links, recent-project
rows); contact links → `text-link` (blue, links-never-red). Forms: single outer card
preserved (FormPageLayout pattern); native selects → registry-style `min-h-11
text-[16px]` red double-ring controls (iOS-zoom idiom); `Loader2` spinners → Button
`loading` prop; footers right-aligned line→primary.

§8 states: auth gates added — clients new (`client.create`), clients/[id]/edit
(`client.update`, hoisted above loading/not-found), suppliers new + orders/new
(`supplier.create` — verified `createSupplier`/`createSupplierOrder` both require
`requirePermission("supplier","create")`), suppliers/[id]/edit (`supplier.update`,
hoisted). List + read-detail pages were already gated (`client`/`supplier` `read`).
Bare "not found" → §8 left-edge `border-l-t-out` error notices (clients + suppliers
detail + both edit pages). Hand-built `ChevronRight` breadcrumbs on suppliers
new/edit/orders-new → registry `Breadcrumb` component (matches clients).

§5.2 sentence case across page titles, section/field labels, button labels, dialog
titles, and the client-type label MAP ("Production Co./Production Company" →
"Production company"; "New Client/Supplier/Order", "Purchase Orders", "Asset Tag",
"Subhire Line Items", "Account Details", "Payment Terms", "Lead Time", "Contact
Name/Email", "Billing/Shipping Address", "Default Discount", "Recent Projects/Orders").

Danger buttons (§1/§3.7): client Archive = reversible → tinted (`text-t-out
hover:bg-out-soft`); supplier Delete = permanent → escalates to solid red
(`hover:bg-red hover:text-white`, the §1 white-on-red exception).

No new status-colors category needed (clientType/supplierOrder/project/asset already
existed). Pre-existing eslint warnings left as-is (unused `DollarSign`/`formatCurrency`
in clients/[id], unused `MapPin` in suppliers/[id], react-hooks `form.watch`
incompatible-library on both forms — all predate this chunk). DEFERRED (recurring
final-pass items, not fixed per-chunk): detail-page hand-built sub-tables (projects/
orders/assets/subhires) lack mobile card lists + left-edge red row hover; the §8
not-found notices are simple left-edge bars.

tsc clean (0 clients+suppliers errors), eslint clean on touched files (only the
pre-existing warnings above).

### Chunk 11 — Test & Tag (polished, pending review)
Swept all 6 pages + the 4 quick-test step components + 2 t&t components
(`components/test-tag/test-tag-table`, `batch-create-dialog`). All scope files
type-errored against the refreshed registry before (28 tsc errors in the rubric
grep `src/app/(app)/test-and-tag/|src/components/test-tag/` → 0; note components
live under `test-tag/` not `test-and-tag/`). Functionality untouched: markup/
className/label + type-level registry swaps + additive status-colors/states only.

**New status-colors categories (§3):** `testTag` (CURRENT=success, DUE_SOON=warning,
OVERDUE/FAILED=error t-out, NOT_YET_TESTED/RETIRED=neutral — §1 overdue/failed is the
problem semantic) and `testTagResult` (PASS=success, FAIL=error, NOT_APPLICABLE=
neutral). Added sentence-case label maps to status-labels.ts: `testTagStatusLabels`,
`testTagResultLabels`, `equipmentClassLabels`, `applianceTypeLabels` — every hand-
rolled status/class/type map across the 5 t&t files now reads from these (was
title-case "Due Soon"/"Not Tested"/"Class II (Double Insulated)"/"Cord Set", and
PASS rendered **teal** — a module hue, not a status — corrected to ok green).

Registry API repairs: `Button variant="outline" + render=` → `"line" + asChild`;
`Badge variant="outline"/default/destructive` → status-only `Badge status` (profile
pill→neutral, boolean OK/Fail check→ok/overbooked) or `StatusIndicator category=`;
`EmptyState` old preset/heading API → title/description; Button `render=` → `asChild`.

RVLT polish: legacy `text-fg*`/`bg-bg-surface`/`surface-ring`/`bg-bg-inset`/
`surface-hover`/`destructive`/`teal-*`/`green-500`/`amber-*`/`red-*` → `bg-card
ring-1 ring-line shadow-[var(--sh-card)]` + ink/muted/line + status tokens. `t-mono`
on tag IDs/serials, `t-data` (tabular-nums) on readings/dates/counts. Skeleton
loaders replace every Loader2/teal border spinner (landing metrics+tables, registry
table, new+quick-test Suspense fallbacks). Button `loading` prop on all submits/
syncs. §1 danger: detail Retire (reversible) tinted t-out, Delete (permanent)
escalates to solid red. §9.1: focusRing on every hand-built control (row/asset/
breadcrumb links, report cards as keyboard `<button>`, search/bulk-asset rows, step
tabs, mobile session-log toggle), aria-pressed on Pass-all toggle, aria-label on
N/A result dots + icon buttons. §15: outlet +/- counter + audio/back → size="icon"
(size-11), report/search rows min-h-11, mobile session bar safe-area-inset-bottom.
§8: detail not-found/error → left-edge t-out notice with retry+back; explicit
emptyDescription on the registry DataTable (it ignores emptyPreset). §9 personality:
quick-test fail dialog + failure-details + retired-asset notice kept plain (alert
contexts) — left-edge accent bars, no Kalam/mascot. §5.2 sentence case across all
titles/labels/option maps/report configs ("Test & tag", "Quick test", "Record test",
"Full register", "Overdue / non-compliant", step "Sub-tests", etc.).

**Auth resource:** `testTag` (read for list/detail/registry, create for new/quick-
test, update on detail actions — all verified against test-tag-assets/records/
profiles requirePermission calls). All page gates already present + hoisted above
loading/not-found (detail wraps Suspense; landing/registry/new/quick-test wrap the
whole tree). Reports keeps its existing `reports`/`view` gate (the report server
actions use getOrgContext; the page reads getTestTagAssets which is testTag-scoped —
left as-is, semantically correct + pre-existing).

DEFERRED (recurring final-pass items): detail Test-history sub-table + landing
overdue/due-soon/recent tables lack mobile card lists (overflow-x-auto only); the
not-found notice is a simple left-edge bar. label-template.tsx (print label) left
untouched — print-template constraint, mirrors the pull-sheet print exception.

tsc clean (0 errors in `src/app/(app)/test-and-tag/|src/components/test-tag/`),
eslint clean on touched files (only pre-existing unused `useCallback`/
`updateTestTagAsset` imports in quick-test/page, `thresholds` in electrical-step,
and form.watch/setState-in-effect react-hooks warnings — all predate this chunk).
status-colors + status-labels unit tests green (11/11).

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

## ⛔ PAUSED — weekly usage limit hit (resets 2026-06-20 18:00 Australia/Sydney)
Subagents fail with the weekly-limit error, so the sweep is paused. Working tree is CLEAN;
chunks 0–8 are fully done+reviewed+fixed and committed. Resume from the outstanding list below.

## Outstanding work (resume point)
### Chunks 9 + 10 — polished + reviewed (Claude + Codex), FIXES APPLIED ✅
All the items below shipped (commits 188c3ec0 / 49301e06 / 082d905e): the four
RequirePermission hoists (split into outer-gate + inner-content components
mirroring assets/registry/[id]), the locations/[id] Delete → CanDo
location.delete split, the location-table New-location CanDo location.create
gate, the maintenance-form AWAITING_PARTS/QA status + TEST_AND_TAG type
SelectItems (sourced from the label maps), the maintenance list TEST_AND_TAG
type filter, the location-table + maintenance-list explicit
emptyTitle/emptyDescription, and the status-labels formatLabel sentence-case
fallback. tsc + eslint clean on touched files; maintenance/location/status-*
unit tests green.

Original fix list (both reviews agreed; label-map findings already fixed in commit 50e1d088):
- **Auth-gate hoist (HIGH ×4):** wrap content ABOVE the loading/not-found branches in
  locations/[id]/page.tsx (location.read), locations/[id]/edit/page.tsx (location.update),
  maintenance/[id]/page.tsx (maintenance.read), maintenance/[id]/edit/page.tsx (maintenance.update).
  Mirror the assets/registry/[id] inner-content-component pattern. (Low real risk — data is already
  server-permission-checked; this just stops an unauthorized user seeing the loading skeleton.)
- **locations/[id] delete gating (MED):** Delete button is under `CanDo location.update`; move it to
  its own `CanDo resource="location" action="delete"`.
- **location-table New-location toolbar (MED):** wrap in `CanDo resource="location" action="create"`.
- **maintenance-form (HIGH, pre-existing):** status Select omits AWAITING_PARTS + QA; type Select omits
  TEST_AND_TAG — add them (use maintenanceStatusLabels / maintenanceTypeLabels). The form is the only
  status editor; these states are otherwise unreachable.
- **maintenance list type filter (LOW):** add TEST_AND_TAG to filterOptions.
- **Empty states (LOW):** location-table + maintenance list pass only emptyPreset (DataTable ignores it)
  → add explicit emptyTitle/emptyDescription.
- **formatLabel fallback (status-labels.ts, MED):** the generic fallback produces Title Case for unmapped
  enums → make it sentence-case (only first word capitalised).

### Chunks 11–16 — NOT STARTED
- 11 Test & Tag (t&t list/[id]/new/quick-test/registry/reports + settings/test-and-tag)
- 12 Availability + Activity + Changelog + Notifications + account + account/notifications
- 13 Settings (settings + ~17 sub-pages + layout)
- 14 Admin (admin, organizations(+[id]), settings, users, layout)
- 15 Auth (login, register(+admin), onboarding, invite, no-org, pending-approval, two-factor, layout) — §17 marketing aesthetic
- 16 Edge/standalone (offline, auditor/[token], warehouse/display/[token], root marketing page)

### Cross-cutting follow-ups (final consistency pass)
- ✅ **status-indicator.tsx dot-variant glow** (commit b8cb97e0): remapped the ring-glow conditionals from
  the legacy class names to the current intentStyles dot tokens (bg-ok/bg-warn/bg-t-out/bg-blue/bg-rep/bg-red)
  and paired each ring colour to match. The 2px glow renders again on every dot-variant indicator
  (~33 consumers). `ring-<token>/20` resolves via the registered `--color-*` tokens.
- ✅ **status-colors.test.ts** (commit d7280a7c): updated the getStatusColor assertions off the legacy
  bg-success/text-success scheme to the current values (bg-ok/text-ok/bg-ok-soft, text-red, text-t-out,
  text-warn, text-blue). `npm test -- status-colors` green.
- **Recurring DEFER:** detail-page hand-built overflow sub-tables → mobile card lists + left-edge red row
  hover (clients/suppliers/locations/assets detail). DataTable `emptyPreset` is ignored (shared) — list
  pages need explicit emptyTitle/description.
- **Run full `npm test` + `npm run build` before shipping** — several agents updated/added tests; confirm green.

## Reinvention pass (post-"bar") — apply the approved project-detail patterns to deep surfaces
The project detail page is the approved bar (see memory project-detail-page-patterns + commits
801779df/0893bf11/7d5376da/3c433c2d/b03f9f79/7c6d2d3a/equipment table fixes). Carry the SAME
language (hero with identity, status/where-is-it surfaced, most-used actions + ⋯ overflow, lean
~4-section sidebar w/ calm muted labels, calm-by-default + hover-reveal controls, no "—" noise,
consistent table grids, density-good) to:
- ◐ Asset record (assets/registry/[id]) — hero w/ status + where-is-it-now + QR action; consolidate
  8 tabs → ~5 (merge Photos+Documents→Files, QR→hero action); unified history timeline; lean sidebar.
- ☐ Model detail (assets/models/[id]) — product/spec record.
- ☐ Warehouse per-project flow — focused scan mode.
- ☐ Crew roster + crew detail — availability board.
- ☐ Equipment registry list — visual gear library (cards, not rows).
- ☐ Kit / Client / Supplier / Location / Maintenance detail pages — detail-page bar.
- ☐ Remaining conformance chunks 11(done?)–16 (settings, admin, auth, edge) — still need the calm-by-default pass.

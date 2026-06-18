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
| 3 | Projects detail + tabs | projects/[id], equipment-tab, crew/services/costs/tasks/managers panels, runsheet, edit, templates | ◐ |
| 4 | Assets | registry list/detail/new/edit, models (+[id]/new/edit), categories, asset/model-checks tabs | ◐ |
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

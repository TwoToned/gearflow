# Settings, Branding & Site Admin

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## The settings index (UX Phase 17, D57, D60, D61)

`/settings` is an INDEX, not a page: one list grouped under Organisation, People & access,
Operations, Money, Integrations, Developer and Danger zone, each row a name, one line, a derived
status word (Team `5 members · 2 invited`, Xero `Connected`, Mira `On · read-only`; `settingsStatus`,
never stored) and a chevron. It replaced the second rail and the phone jump-select. Search is `?q=`
and matches names, descriptions AND the parts inside pages (`tax` finds Billing, Services, Xero). A
row the role can't open is absent (never greyed) with one muted footer line naming them.

**One registry, `src/lib/settings-registry.ts`.** The rows, the search haystack, the per-route
gate (`settingsGateOpen`, read by the layout AND the index) and the status key all come from it;
`settings-registry.test.ts` fails if a `settings/<x>/page.tsx` has no row. Adding a settings page
= one row there. A section page is a record page without tabs: back link, title, identity line
(`settings/layout.tsx`); flat sections and the sticky dirty bar are `settings-section.tsx`.

Moves: **General** is `/settings/general` (the old `/settings` content); **invoice numbering and
the default tax rate** live on **Billing** (the old Billing "Tax rate" box wrote `settings.taxRate`,
which nothing reads, so it was dropped, not moved); the **API kill switch** lives on
**Danger zone** (`/settings/danger-zone`, same `setOrgApiKillSwitch`, `orgSettings:update`).

## Settings → Team (UX Phase 17, D58, D59)

`/settings/team` is five hairline sections with a mono count: Members, Invitations, Join requests,
Join policy, Roles & permissions. Rows are the shared `LineRowList` (tick, shift-range, select-page,
row ⋯, phone cards) with a contextual `BulkBar`: members `Change role… n` / red `Remove n`,
invitations `Resend n` / red `Revoke n`. A verb the role can't use is ABSENT. Invite is a dialog
(inline email validation: malformed, already a member, already invited; the roles the viewer may
hand out as radios with `ASSIGNABLE_ROLE_OPTIONS` descriptions). Join policy is three radio rows with
a `Save join policy` bar and a leave guard. Pure model: `src/lib/team-model.ts`; surfaces:
`src/components/settings/team/*`.

**One role policy** (`src/lib/member-role-policy.ts`, read by the invite, single and bulk role
change, removal, resend/revoke and Undo): an actor may hand out a role, or touch a member, only when
that role's rights (read from `rolePermissions`, never a second ranking) are a STRICT subset of their
own; the Owner is never a target or assignable. So an Admin can't raise anyone to Admin or touch an
Admin, and the owner can't be demoted or removed by any path (there is no "last owner" special case:
ownership is only ever transferred). `addMemberByEmail` now also requires `orgMembers:invite` on the
server. There is ONE role list: `ASSIGNABLE_ROLE_OPTIONS` (the member list and the join-request
picker used hand-kept copies that had drifted: warehouse was missing).

**Writes** (`src/server/team.ts` → `src/lib/team-writes.ts`): bulk calls are capped at 50 ids (schema-pinned,
`validations/team.test.ts`), run the policy per row, and report what changed and what was skipped with the
reason (never a whole-call failure). An unexpected error on one row skips THAT row; the rows that did change
keep their Undo.
- **Fails closed.** A role only counts if it is exactly a `rolePermissions` key. An unknown, empty or
  comma-compound role ("admin,member") can't be a target, an actor or an assigned role; any compound naming
  "owner" is the owner. The Better Auth endpoints that could write such a role are switched off
  (`src/lib/auth-disabled-paths.ts`, the hotfix for the stock `organization()` plugin's default admin access
  control); this policy is the second line.
- **Order.** Prisma is the source of truth: a role change writes it FIRST with a compare-and-set on the role it
  read (`where: { id, role }`, count checked), then mirrors to Convex (strict). If the mirror fails, Prisma is
  compensated (CAS back) and the row is reported. Removal is the one exception, Convex-FIRST: a revocation whose
  mirror write failed after Prisma committed would leave a stale grant (RBAC reads the mirror), so it fails closed.
- **Resend** extends the SAME invitation and re-emails the same link, so there is one live token, never two.
  **Cooldown:** at most one resend per invitation per 10 minutes, on the server: last-sent is derived from
  `expiresAt - 7d`, plus a per-window marker so resend, Undo, resend can't mail someone in a loop. **Revoke**
  sets `cancelled` (CAS on status and expiry).
- **Undo** (role change, resend, revoke) takes ONLY a server-signed token (`team-undo-token.ts`, HMAC under a
  purpose-separated HKDF key, `hmac-purpose.ts`, purpose `team-undo:v1`, so it can't verify as, or be forged from,
  any other signed token; Xero state has its own purpose and still accepts its pre-change form for its 10-minute
  life). Team data lives in Better Auth's tables whose audit rows are best-effort mirrors, so "read your own audit
  row" has nowhere reliable to read from and a schema change was not on the table. It is author-only, 10 minutes
  on the server clock, once, and atomic: EVERY row is pre-checked (Prisma role AND the Convex mirror must both
  equal what the write left, else refuse) before anything is written; the once-marker (`undo:<id>`) is claimed only
  after the pre-checks pass, so a refused Undo never burns the token; the writes are one Prisma `$transaction`
  with a compare-and-set per row (a miss rolls everything back); then the mirror, and if it fails Prisma is put
  back and the failure reported. The policy is re-checked at undo time. Resend's Undo puts the prior expiry back
  (the email can't be recalled; the toast says so). Revoke's Undo restores the identical row only if nothing
  re-invited that email or added it as a member meanwhile.
- **Remove has NO Undo**: it emails the person and ends their access, and re-adding creates a new membership
  (new id, new joined date), not the one removed. The confirm dialog says so.
- `addMemberByEmail` takes a Zod body (`inviteSchema`) and throws `UserFacingError`s.
- An invitation's Expired state is derived from `expiresAt` on read (`getPendingInvitations` now returns
  pending rows past their date so they can be resent; bounded to 200).

**Roles grid** (D58): read-only, every cell computed from `PERMISSION_REGISTRY` + `hasPermission`
(`src/lib/roles-grid.ts`), never a copy. A cell reads `All`, `3/6` or `—`; a resource opens to
per-action ticks; the footer is `Actions granted n/m`. The phone shows the six roles as rows. Editing
roles is a later, separate schema decision. `PermissionMatrix` (unused) is deleted.

Known pre-existing gap, not changed here: approving or rejecting a join request or SSO approval gates
on `orgMembers:create`, an action no role but the owner holds, so an Admin can't approve.

## Org Settings (`Organization.metadata` JSON)
```json
{
  "country": "AU",
  "assetTagPrefix": "TTP",
  "assetTagDigits": 5,
  "assetTagCounter": 42,
  "testTag": {
    "prefix": "TT",
    "digits": 5,
    "counter": 1,
    "defaultIntervalMonths": 6,
    "defaultEquipmentClass": "CLASS_I",
    "dueSoonThresholdDays": 30,
    "companyName": "...",
    "defaultTesterName": "...",
    "defaultTestMethod": "BOTH",
    "checkoutPolicy": "..."
  }
}
```

Abbreviated — the real, current shape is `OrgSettings` in
`src/lib/org-settings-types.ts` (business identity: `email`/`phone`/`website`/
`address`/`abn`; the `documents` sub-object: footer text, terms & conditions
+ its `showTermsAndConditionsOnInvoice` invoice toggle, `paymentDetails`,
`quoteValidityDays`, `paymentTermsDays`; plus branding/invoice-numbering/SSO —
see FEATUREDOCS/13 for what each `documents` field renders on which PDF doc
type). `abn` is edited on the General settings page (`/settings/general`, next to
address/email/phone); the `documents` fields are edited on the "Documents"
card at `/settings/branding` (`document-settings.tsx`).

### Status automation switches (#1160)

`OrgSettings.projectStatusAutomation` — four optional booleans
(`quoteSent`/`prepStarted`/`allCheckedOut`/`allReturned`), **absent = ON**, so
every pre-#1160 org gets the automation with no backfill and the blob only ever
stores an explicit opt-OUT (turning a switch back on DELETES the key — one
representation of the default). Edited on the General settings page under
"Status automation" (`status-automation-settings.tsx`), validated on write by
`projectStatusAutomationSchema` (`.strict()`, so a mistyped key is rejected
rather than silently persisted and read back as "enabled"), and read
IN-mutation by `resolveAutoStatusEnabled` (`convex/lib/orgSettings.ts`) — never
trusted from a client argument. The rules themselves live in
`convex/lib/projectAutoStatus.ts`; see
[76 — Project Status Automation](./76-project-status-automation.md).

### The country table (I1, #1079)

`src/lib/countries.ts` is the single source of truth (POLICY.md R-3.1) for
every country-derived property — currency, date order/separator, decimal
separator, week start, paper size, unit system, tax label, default tax rate,
and the business-number label — for the launch markets (M1: AU/NZ/UK/US/IE)
plus NL/DE, which ship in the table but are excluded from
`listEnabledCountries()` until decimal-comma input parsing (#1087, M7) lands.
Adding a country is a data row there, not code. The US row's
`defaultTaxRate` is genuinely `null` (no national rate) — never invent one
(see #1088). Each row also carries a `locale` (BCP-47, e.g. `"en-GB"`) — the
country's OWN locale, driving `Intl`-backed formatting for free. Consumers:
`formatters.ts` (I2, wired below), the document composer (I4/I5, doc labels
+ paper size) and calendar/unit settings (I6) — still unwired.

### Locale-aware formatting (I2, #1081)

`formatCurrency`/`formatDate` (`src/lib/formatters.ts`) take an **optional**
`FormatConfig` (`{ locale, currency }`) — omit it and you get the exact
pre-#1081 AU rendering, so every one of the 241 pre-existing call sites keeps
working unchanged until it migrates. `formatConfigFromOrgSettings()` derives
one from `OrgSettings.country` (via the I1 table above) with
`OrgSettings.currency` as an explicit override of just the currency (the
locale, i.e. date order, still comes from the country). Two consumers:

- **Client** — `FormatProvider` (`src/components/providers/format-provider.tsx`)
  is mounted in the app layout next to `BrandingProvider` (same `useOrganization`
  store, no extra fetch) and exposes `useFormatters()` → locale-bound
  `formatCurrency`/`formatDate`. A component must explicitly call the hook to
  render in the org's own country/currency — mounting the provider alone
  changes nothing for the plain imported functions.
- **Server/PDF** — call `formatConfigFromOrgSettings(orgSettings)` directly
  wherever `orgSettings` is already in hand (e.g. `build-document-data.ts`)
  and pass the result as `formatCurrency`'s/`formatDate`'s second arg.

**Not done in #1081**: migrating the 241 call sites (only
`src/lib/billing-derivation.ts`'s inline `$${n.toFixed(2)}` — the one
offender the issue named explicitly — was routed through `formatCurrency`),
or threading a `FormatConfig` through the PDF pipeline (`gearflow-table.ts`,
`document-composer.ts`, the 11 other pdfme files that call these two
functions) — that pipeline still renders every org's documents in AU
formatting regardless of the org's real country, and needs its own pass with
the per-doc-type integration tests CLAUDE.md's PDF rule requires for a
pagination-adjacent change.

### Named date-format roles + the inline-format ratchet (I3, #1082)

Beyond `formatDate`'s hardcoded locale (fixed by I2), `date-fns` `format(date,
"…")` calls were scattered across ~20 files and **contradicted each other at
the same AU locale** — some screens used day-first ("d MMM"), others
month-first ("MMM d, yyyy") for the same kind of field. `src/lib/formatters.ts`
adds four named roles alongside `formatDate` (the "short" role), all built on
one shared `formatDateWithOptions` (`Intl`-backed, so date order/separator
comes free per locale — no per-country date logic needed):

- `formatDateDayMonth` — no year (compact range/relative labels)
- `formatDateLong` — weekday + full month + year (always includes the year;
  some pre-#1082 call sites dropped it inconsistently)
- `formatDateWithTime` — the short role + a 24-hour clock, **pinned** with
  `hour12: false` (date-fns's `"HH:mm"` was always 24-hour regardless of
  locale; `Intl`'s default isn't, so it's forced explicitly)
- `formatMonthYear` — month + year only (calendar headers)

All four are exposed on `useFormatters()` too. Migrated in #1082: the
concrete month-first-vs-day-first contradiction (`activity/page.tsx`,
`maintenance/page.tsx` ×2, `maintenance/due/page.tsx` ×2, `dashboard/page.tsx`
×2) — the Maintenance section + Activity log were the month-first outliers
against day-first everywhere else. **Not migrated**: the remaining ~15 inline
`format()` calls with word-based date tokens (booking calendar, availability
page, `range-calendar.tsx`, `project-wizard.tsx`, `my-work-section.tsx`) —
left for incremental follow-up. `"yyyy-MM-dd"`/`"yyyy-MM"` MACHINE formats
(keys, query params, filenames, ical) are correctly locale-independent and
were never in scope.

**Client surfaces on the org locale (second sweep).** These formerly hardcoded
`"en-AU"` (or the viewer's browser locale via `undefined`) and now call
`useFormatters()`: the activity timeline and asset check history
(`formatDateWithTime`), the call-sheet day picker (`formatWeekdayDayMonth`), the
job board card (`formatDateDayMonth` + `formatCurrency(…, { cents: false })`),
custom-field DATE values (`formatDate`), the account "Member since"
(`formatMonthYear`), display-token "Last seen" (`formatDateWithTime`) and the job
version drift line (`formatCurrency`). **Still hard-coded, deliberately left**
(they have no `useFormatters()` or need a timezone/number-only role): the UTC-pinned
day labels (`logistics/people-view.tsx`, `maintenance/record/parts-tab.tsx`),
the pure `src/lib/list-views/*.ts` row builders, the printed test-tag label,
number-grouping `toLocaleString("en-AU")` calls, the warehouse display board
(token page, no org context), and server-side e-mail / PDF / export renderers.
The ratchet pattern does not see these (it matches `format(…, "…MMM…")` only), so
the next sweep is a grep for `toLocale(Date|Time)?String\(("en-|undefined)`.

**The ratchet** (`scripts/date-format-ratchet.sh`, `pnpm run
date-format-ratchet`, wired into CI's `hygiene` job): counts inline `format(x,
"…")` calls whose format string contains a word-based month/weekday token
(`MMM`/`MMMM`/`EEE`/`EEEE` — the exact axis that reorders per locale). The
count is a ratchet baseline (`.date-format-ratchet-baseline`, currently 15)
like `any-ratchet`/`knip-ratchet`/`complexity-ratchet` — it can only go down;
a new inline display-date format string fails CI, forcing new dates through a
named role instead.

`OrgSettings.country` (the field above) is **immutable after creation
(M6)** — `src/server/settings.ts`'s `updateOrganization` enforces it
server-side via `withImmutableCountry()`, which forces the persisted value
back onto any patch once one is set, the same "strip on the server" posture
as `PROJECT_UPDATE_IMMUTABLE` (`convex/projectWrites.ts:420`). This is
independent of the pre-existing, broader `COUNTRIES` picker on the General
settings page (`settings/page.tsx`) — that one biases Places-autocomplete
address lookups across ~19 countries and is a different concern from the
7-row operational table above; Phase C's wizard country step is what wires
the two together.

### Week start + address bias (I6, #1086)

`useOrgWeekStartsOn()` (`src/lib/use-org-country.ts`, sibling to
`useOrgCountry()`) returns `date-fns`'s `weekStartsOn` value (`0` Sunday /
`1` Monday) from the country table, defaulting to Monday (`1`) when no
country is set — the same value every hardcoded `weekStartsOn: 1` it
replaces already assumed. Wired into:

- `crew/planner/page.tsx` — its hand-rolled `startOfWeek()` (a DRY violation,
  ignoring `date-fns` entirely) is gone; it now calls `date-fns`'s
  `startOfWeek(date, { weekStartsOn })`.
- `availability/page.tsx` — `gridStart`/`gridEnd` use the hook instead of a
  hardcoded `{ weekStartsOn: 1 }`. Also fixes a companion bug the week-start
  change would otherwise have introduced: the month grid's `WEEKDAYS` header
  labels were a hardcoded Monday-first array — for a Sunday-starting org the
  header and the day cells would have visibly misaligned. Both now derive
  from the same `weekStartsOn` via `weekdayLabels()`.

Second sweep (post-redesign): the shared `RangeCalendar` (job wizard / filters),
the wizard's availability read window (`new-job/availability-line.tsx`, which
must widen over the SAME grid the calendar draws) and the Bookings calendar
(`bookings/booking-calendar.tsx`) now take `useOrgWeekStartsOn()` instead of a
hardcoded `{ weekStartsOn: 1 }`. Their weekday header rows come from
`weekdayLabels(weekStartsOn, config)` (`src/lib/formatters.ts`, `Intl`-derived
and locale-aware) so header and cells cannot disagree. Any new calendar grid
MUST use the hook + `weekdayLabels`, never a literal week start or a literal
`["Mon", …]` array.

Address-bias (`AddressInput`'s `countryCode` prop via `useOrgCountry()`) was
already wired everywhere except `services-panel.tsx`'s delivery/pickup
address field — the one gap, now closed. See FEATUREDOCS/30 for the full
Places-autocomplete picture.

**Not done in #1086** — units (weights/dimensions/rigging loads, kg-only
today): the issue itself flags this as an open scope question ("decide the
boundary before implementing rather than during" — dimensions and rigging
loads are a larger surface than weights alone, and mixed units in a
warehouse are their own hazard) rather than a spec to implement blind.
Deferred pending that decision. Number grouping needed no work — it came
free once the locale was threaded (I2, #1081).

## Platform Branding (`SiteSettings`)
- `platformName` — Displayed in sidebar, page titles, emails
- `platformIcon` — Lucide icon name, rendered via `DynamicIcon`
- `platformLogo` — Uploaded image URL
- Dynamic favicon via `DynamicFavicon` component — the platform icon on the org's primary colour; with no platform icon an `RVLT…` platform shows the R mark (`RVLT_R_PATH` from `rvlt-mark.tsx`) and a white-labelled one its first letter. The tile defaults to RVLT red `#E0363D` when the org has no branding colour.

## Client-Side Hooks
- `usePlatformName()` — Returns platform name string
- `usePlatformBranding()` — Returns `{ name, icon, logo }`
- `BrandingProvider` context wraps the app layout

## Site Admin Panel
- **Access**: `User.role === "admin"` checked server-side in admin layout. First user auto-promoted.
- `/admin` — Dashboard with org count, user count, storage stats
- `/admin/organizations` — Single-org view with stats, export/import, manage link
- `/admin/organizations/[id]` — Org detail with member list, export button
- `/admin/users` — User list, promote to admin, ban/unban, force-disable 2FA
- `/admin/settings` — Platform name, icon, logo, registration policy, 2FA global policy,
  default currency/tax, org-creation gate (Phase B, B3/#1095: allow-org-creation toggle,
  require-signup-code toggle, signup code with copy/regenerate — see FEATUREDOCS/04)
- **Mobile**: `AdminShell` component with hamburger menu replacing desktop sidebar

## Document Templates — removed (#790)

There is no document template settings page and no template designer of any
kind — `/settings/documents` and the underlying customization engine
(stored per-org templates, `document.manage_templates` permission) were
deleted outright in the PDF system redesign. PDF generation for the 5
project document types now uses one fixed pipeline (`document-layouts.ts` →
`document-composer.ts`) with no per-org overrides; org-level branding
(colour, logo mode, company details) still lives at `/settings/branding` —
see FEATUREDOCS/13.

## Dashboard & Reporting
- **Home** (`/dashboard`; labelled "Dashboard" before UX Phase 0, D66): the user's home screen. Leads with a personalised greeting
  (time-of-day + first name) and a **"Your projects"** section — projects the signed-in user
  manages, found via BOTH `Project.projectManagerId` AND the `ProjectManager` join
  (`home` query in `convex/dashboardLists.ts`, active projects only). Each card shows status,
  client, equipment count, and a status-aware date line ("Returns in 2d", "Overdue 3d",
  "Starts today"), colour-coded by status intent. A "Needs attention" row chips overdue
  returns / maintenance due / pending crew offers from the org stats (or "You're all caught
  up"). Component: `components/dashboard/my-work-section.tsx`. Below that: the org metrics
  strip (Total Assets, Deployed, Active Projects, Crew), upcoming projects, and the recent
  activity feed. (Future: a "My tasks" section surfacing cross-project task assignments —
  Project Tasks (see [50-project-tasks](./50-project-tasks.md)) has shipped per-project, but
  no cross-project "my open tasks" query exists yet.)
- **Reports**: The general-purpose custom report builder (`/reports` — quick stats, ~30-report library, saved reports with pin/share) was removed entirely (`chore: remove Reports tab`). What remains: Test & Tag compliance reports at `/test-and-tag/reports` (see [14-test-and-tag](./14-test-and-tag.md)), and the `reports` permission resource, which also gates the Activity Log nav item.
- Notification-driven alerts surface the same data as the notification system

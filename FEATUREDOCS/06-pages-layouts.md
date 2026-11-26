# Page Routes & Layouts

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

## Layout Architecture

**Root Layout** (`src/app/layout.tsx`): `html > body > ThemeProvider > QueryProvider > {children} > Toaster`

**App Layout** (`src/app/(app)/layout.tsx`):
```
div.app-shell (fixed inset-0 on mobile, relative on desktop)
├── SidebarProvider (flex-1, min-h-0)
│   ├── AppSidebar (Sheet <= 859px; 220px sidebar >= 1024px; automatic 72px icon rail 860-1023px — a CSS (`max-lg`) swap between two rendered views so SSR paint is right; ⌘B collapses to the rail at >= 1024px, remembered in the `sidebar_state` cookie read by this layout)
│   └── SidebarInset (flex column)
│       ├── TopBar (sticky, safe area padding)
│       └── main (flex-1, overflow-auto, content scrolls here)
└── MobileNav (shrink-0, hidden on md+)
```

**The shell (6a)** is built from one table, `src/lib/nav.ts` (`NAV`): `AppSidebar` (220 px, three hairline groups, org switcher in the head), the 72 px rail flyouts (`sidebar-rail.tsx`), `MobileNav` + `MoreSheet`, the top bar's `Breadcrumbs` (`src/lib/breadcrumbs.ts`; `document.title` is the trail's last segment), the user menu (personal: Theme words, shortcuts, Sign out last), the bell (`useShellFeed`: derived feed + stored mentions, Mark all read + Undo through `markUnreadManyNative`/`undismissManyNative`) and the palette `@` pages. Gating is applied once in `useNavItems()`. `ScanTargetProvider`/`BreadcrumbProvider` wrap the `(app)` layout.

**`MobileNav` (`src/components/layout/mobile-nav.tsx`) single-flight navigation guard.**
Mobile bug: rapidly tapping one bottom-nav tab then a different one could snap the
user back to the first tab — the App Router doesn't guarantee two overlapping soft
navigations resolve in the order they were triggered (vercel/next.js#83386), and
mobile's higher latency widens the race window a lot versus desktop. This is a
distinct bug class from the `useServerMutation` stale-navigation guard (see
FEATUREDOCS/54 — that one gates a mutation's `onSuccess` `router.push` on the
triggering view still being mounted; this one guards two competing plain
navigations). `useSingleFlightNavClick` replaces `next/link`'s `<Link>` with a
`router.push`-driven `<a onClick>` (same reason the shared `NavLink`
(`nav-link.tsx`) isn't a plain `<Link>`, though for a different underlying bug) that
tracks one pending destination in a ref: a second tap on a *different* tab while
a navigation is still in flight is dropped, and a 1.5s safety-valve timeout clears
the guard if a navigation stalls so the bar never gets stuck. Tapping the
already-pending or already-active tab is always a no-op. Regression test:
`src/components/layout/__tests__/mobile-nav.test.tsx`.

**Admin Layout** (`src/app/(admin)/admin/layout.tsx`): Server-side role check + `AdminShell` component with own responsive sidebar

**Auth Layout** (`src/app/(auth)/layout.tsx`): Centered card, no sidebar

**Auth playful shell** (`src/app/(auth)/auth-playful.tsx`): the login / register / admin-register screens share a decorative-only split-panel shell (`AuthShell`) following the marketing aesthetic (DESIGN.md §17 "Auth pages"). Desktop shows a `bg-paper-2` brand collage — `RvltFlowLogo` wordmark, the `FlowMascot` roadie, scattered module-hue `FeaturePatch` stickers (red is never a module hue), a CSS GAFF tape-roll sticker, doodle SVGs (star/arrow/squiggle), and Kalam (`.t-annotation`) annotations. The form sits on a `bg-card` surface with stickers peeking over the corners. Everything decorative is `aria-hidden` + `pointer-events-none`; the auth form logic (email/password/passkey/SSO, registration policy states, admin token gate) is untouched — the shell only wraps presentation. Personality/mascot/Kalam are sanctioned here per DESIGN.md §9 (onboarding moments) and §17; the DISABLED/INVITE_ONLY notice states stay plain.

## All Pages

### Authentication
| Path | Page |
|------|------|
| `/login` | Login form (two-step: email → password/SSO redirect) |
| `/register` | Registration (respects registration policy) |
| `/register/admin` | Secret admin registration (token-gated) |
| `/two-factor` | TOTP verification after login |
| `/invite/[id]` | Accept team invitation |
| `/welcome` | Create-vs-join fork for a signed-in user with no live org (B1, #1092) |
| `/setup` | Org setup wizard shell + step 0, name/slug (redirects to dashboard if org exists) — C1, #1098; formerly `/onboarding` |
| `/pending-approval` | SSO user pending admin approval |

### App (Protected)
| Path | Page |
|------|------|
| `/dashboard` | Overview, stats, recent activity, upcoming projects |
| `/my-tasks` | This user's open tasks (direct + crew assignment) across every project — plain list, tick to complete (FEATUREDOCS/50) |
| `/finance` | Org-level Finance section (#992) — quotes out, expiring, never sent, deposit due, outstanding; single bounded aggregation, not a per-project loop; see [66-finance-quotes-invoices-xero.md](./66-finance-quotes-invoices-xero.md) |
| `/assets/registry` | Serialized + bulk asset list |
| `/assets/registry/new` | Create asset(s) |
| `/assets/registry/[id]` | Asset detail (tabs: info, history, maintenance, media) |
| `/assets/registry/[id]/edit` | Edit asset |
| `/assets/models` | Equipment model list |
| `/assets/models/new` | Redirects to `/assets/models?new-model=1` (the model sheet, [08](./08-assets.md)) |
| `/assets/models/[id]` | Model detail (specs, assets, kits, accessories, media) |
| `/assets/models/[id]/edit` | Redirects to `/assets/models/[id]?edit-model=[id]` (the model sheet) |
| `/assets/categories` | Category list (table with indented children) |
| `/assets/categories/[id]` | Category detail (subcategories, models & kits tabs) |
| `/availability` | Availability calendar (top-level) — draws RENTAL window bars, not the PROJECT window (deliberate, WS2 #941 — pricing's window is what's visually "booked"; see [11-availability.md](./11-availability.md)) |
| `/overbookings` | Overbookings & Gaps board (WS3 #942) — org-wide hard/pencilled overbooking + crew-gap risk over a selectable date range; see [65-overbookings-gaps-board.md](./65-overbookings-gaps-board.md) |
| `/kits` | Kit list |
| `/kits/new` | Create kit |
| `/kits/[id]` | Kit detail (contents, media, status) |
| `/kits/[id]/edit` | Edit kit |
| `/projects` | Project list (filterable by status, client, date) |
| `/projects/new` | Create project |
| `/projects/[id]` | Project detail — tabs: Equipment · Logistics (`?tab=logistics`, FEATUREDOCS/84; `/runsheet` redirects here) · **Finance** (#989 — quote revisions, send/issue dialogs, invoices; retired the old "Financials" tab, not duplicated) · Tasks · Notes · Files |
| `/projects/[id]/edit` | Redirect to `/projects/[id]?edit=1` (the job edit sheet) |
| `/projects/templates` | Redirect to `/projects?templates=1` (the Manage templates dialog) |
| `/projects/templates/new` | Redirect to `/projects?templates=new` (the New template sheet) |
| `/crew` | Crew member list |
| `/crew/new` | Create crew member |
| `/crew/[id]` | Crew member detail (contact, rates, skills, certifications) |
| `/crew/[id]/edit` | Edit crew member |
| `/clients` | Client list |
| `/clients/new` | Create client |
| `/clients/[id]` | Client detail (projects, notes, files tabs; sidebar contacts manager — see FEATUREDOCS/63) |
| `/clients/[id]/edit` | Edit client |
| `/suppliers` | Supplier list |
| `/suppliers/new` | Create supplier |
| `/suppliers/[id]` | Supplier detail (orders, assets, subhires tabs) |
| `/suppliers/[id]/edit` | Edit supplier |
| `/suppliers/[id]/orders/new` | Create supplier order |
| `/warehouse` | The floor (five derived stage columns); `?mode=returning` is Returning mode — the org-wide returns desk (FEATUREDOCS/12) |
| `/warehouse/returns` | Redirect → `/warehouse?mode=returning` (query kept) |
| `/warehouse/[projectId]` | Check out/in interface; `?doc=pull-sheet` opens the pull-sheet dialog |
| `/warehouse/[projectId]/pull-sheet` | Redirect → `/warehouse/[projectId]?doc=pull-sheet` |
| `/scan` | The Scan page (Phase 16): `?mode=check` (ad-hoc check, FEATUREDOCS/37) or `?mode=tt` (test & tag, FEATUREDOCS/14), `?tag=` the loaded tag; NAV Warehouse › Scan |
| `/check/[assetTag]` | Redirect → `/scan?mode=check&tag=…` |
| `/locations` | Location hierarchy |
| `/locations/new` | Create location |
| `/locations/[id]` | Location detail |
| `/locations/[id]/edit` | Edit location |
| `/maintenance` | Maintenance record list |
| `/maintenance/new` | Redirects to the Maintenance sheet (`/maintenance?new=1`); `/maintenance/[id]/edit` redirects to `/maintenance/[id]?edit=1` |
| `/maintenance/[id]` | Maintenance detail |
| `/test-and-tag` | T&T overview |
| `/test-and-tag/registry` | T&T item list |
| `/test-and-tag/new` | Create T&T item |
| `/test-and-tag/[id]` | T&T item detail + test records |
| `/test-and-tag/quick-test` | Redirect → `/scan?mode=tt` (`?id=` carried as `tag`) |
| `/test-and-tag/reports` | 10 report types |
| `/reports` | Business analytics |
| `/activity` | Activity log (audit trail) |
| `/settings` | Settings overview |
| `/settings/assets` | Asset tags, links to suppliers & categories |
| `/settings/test-and-tag` | T&T ID format, defaults |
| `/settings/billing` | Currency & tax |
| `/settings/branding` | Logo & colors |
| `/settings/displays` | Warehouse display token management |
| `/settings/team` | Members, invites, roles, permission matrix |
| `/settings/sso` | SSO configuration (providers, provisioning, group mapping, enforcement) |
| `/account` | Profile, password, 2FA, sessions |
| `/changelog` | Product changelog |

### Public (Token-Authenticated)
| Path | Page |
|------|------|
| `/warehouse/display/[token]` | Warehouse TV dashboard (dark, auto-refresh, no login) — dispatch/return/prep cards read the PROJECT window (`getProjectWindow`, WS2 #941), see [11-availability.md](./11-availability.md) |

### Admin
| Path | Page |
|------|------|
| `/admin` | Admin dashboard |
| `/admin/organizations` | Single-org view (stats, export/import, manage link) |
| `/admin/organizations/[id]` | Org detail |
| `/admin/users` | User list (promote, ban) |
| `/admin/settings` | Platform settings |

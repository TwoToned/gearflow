# Page Routes & Layouts

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Layout Architecture

**Root Layout** (`src/app/layout.tsx`): `html > body > ThemeProvider > QueryProvider > {children} > Toaster`

**App Layout** (`src/app/(app)/layout.tsx`):
```
div.app-shell (fixed inset-0 on mobile, relative on desktop)
├── SidebarProvider (flex-1, min-h-0)
│   ├── AppSidebar (Sheet on mobile, fixed sidebar on desktop)
│   └── SidebarInset (flex column)
│       ├── TopBar (sticky, safe area padding)
│       └── main (flex-1, overflow-auto, content scrolls here)
└── MobileNav (shrink-0, hidden on md+)
```

**`MobileNav` (`src/components/layout/mobile-nav.tsx`) single-flight navigation guard.**
Mobile bug: rapidly tapping one bottom-nav tab then a different one could snap the
user back to the first tab — the App Router doesn't guarantee two overlapping soft
navigations resolve in the order they were triggered (vercel/next.js#83386), and
mobile's higher latency widens the race window a lot versus desktop. This is a
distinct bug class from the `useServerMutation` stale-navigation guard (see
FEATUREDOCS/54 — that one gates a mutation's `onSuccess` `router.push` on the
triggering view still being mounted; this one guards two competing plain
navigations). `useSingleFlightNavClick` replaces `next/link`'s `<Link>` with a
`router.push`-driven `<a onClick>` (same reason `app-sidebar.tsx`'s desktop
`NavLink` isn't a plain `<Link>`, though for a different underlying bug) that
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
| `/onboarding` | First-time org setup (redirects to dashboard if org exists) |
| `/pending-approval` | SSO user pending admin approval |

### App (Protected)
| Path | Page |
|------|------|
| `/dashboard` | Overview, stats, recent activity, upcoming projects |
| `/assets/registry` | Serialized + bulk asset list |
| `/assets/registry/new` | Create asset(s) |
| `/assets/registry/[id]` | Asset detail (tabs: info, history, maintenance, media) |
| `/assets/registry/[id]/edit` | Edit asset |
| `/assets/models` | Equipment model list |
| `/assets/models/new` | Create model |
| `/assets/models/[id]` | Model detail (specs, assets, kits, accessories, media) |
| `/assets/models/[id]/edit` | Edit model |
| `/assets/categories` | Category list (table with indented children) |
| `/assets/categories/[id]` | Category detail (subcategories, models & kits tabs) |
| `/availability` | Availability calendar (top-level) |
| `/kits` | Kit list |
| `/kits/new` | Create kit |
| `/kits/[id]` | Kit detail (contents, media, status) |
| `/kits/[id]/edit` | Edit kit |
| `/projects` | Project list (filterable by status, client, date) |
| `/projects/new` | Create project |
| `/projects/[id]` | Project detail (line items, documents, financials) |
| `/projects/[id]/edit` | Edit project |
| `/projects/templates` | Template list |
| `/projects/templates/new` | Create template |
| `/crew` | Crew member list |
| `/crew/new` | Create crew member |
| `/crew/[id]` | Crew member detail (contact, rates, skills, certifications) |
| `/crew/[id]/edit` | Edit crew member |
| `/clients` | Client list |
| `/clients/new` | Create client |
| `/clients/[id]` | Client detail |
| `/clients/[id]/edit` | Edit client |
| `/suppliers` | Supplier list |
| `/suppliers/new` | Create supplier |
| `/suppliers/[id]` | Supplier detail (orders, assets, subhires tabs) |
| `/suppliers/[id]/edit` | Edit supplier |
| `/suppliers/[id]/orders/new` | Create supplier order |
| `/warehouse` | Warehouse project list |
| `/warehouse/[projectId]` | Check out/in interface |
| `/warehouse/[projectId]/pull-sheet` | Pull sheet preview + print |
| `/locations` | Location hierarchy |
| `/locations/new` | Create location |
| `/locations/[id]` | Location detail |
| `/locations/[id]/edit` | Edit location |
| `/maintenance` | Maintenance record list |
| `/maintenance/new` | Create maintenance record |
| `/maintenance/[id]` | Maintenance detail |
| `/test-and-tag` | T&T overview |
| `/test-and-tag/registry` | T&T item list |
| `/test-and-tag/new` | Create T&T item |
| `/test-and-tag/[id]` | T&T item detail + test records |
| `/test-and-tag/quick-test` | Quick test form |
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
| `/warehouse/display/[token]` | Warehouse TV dashboard (dark, auto-refresh, no login) |

### Admin
| Path | Page |
|------|------|
| `/admin` | Admin dashboard |
| `/admin/organizations` | Single-org view (stats, export/import, manage link) |
| `/admin/organizations/[id]` | Org detail |
| `/admin/users` | User list (promote, ban) |
| `/admin/settings` | Platform settings |

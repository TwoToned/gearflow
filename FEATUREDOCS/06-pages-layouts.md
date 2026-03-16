# Page Routes & Layouts

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

**Admin Layout** (`src/app/(admin)/admin/layout.tsx`): Server-side role check + `AdminShell` component with own responsive sidebar

**Auth Layout** (`src/app/(auth)/layout.tsx`): Centered card, no sidebar

## All Pages

### Authentication
| Path | Page |
|------|------|
| `/login` | Login form |
| `/register` | Registration (respects registration policy) |
| `/register/admin` | Secret admin registration (token-gated) |
| `/two-factor` | TOTP verification after login |
| `/invite/[id]` | Accept team invitation |
| `/onboarding` | First-time org setup |
| `/no-organization` | No org memberships (shows pending invites) |

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
| `/settings/documents` | Document template management — cards grouped by doc type |
| `/template-designer/[id]` | Full-screen pdfme template designer |
| `/settings/branding` | Logo & colors |
| `/settings/team` | Members, invites, roles, permission matrix |
| `/account` | Profile, password, 2FA, sessions, organizations |
| `/changelog` | Product changelog |

### Admin
| Path | Page |
|------|------|
| `/admin` | Admin dashboard |
| `/admin/organizations` | Org list (CRUD, export/import) |
| `/admin/organizations/[id]` | Org detail |
| `/admin/users` | User list (promote, ban) |
| `/admin/settings` | Platform settings |

<!-- Owner: Jayden Nawotka · Last reviewed: 2026-07-18 (review quarterly — POLICY.md R-5.5) -->
<div align="center">

# RVLT Flow
[![Build & Deploy](https://github.com/RVLT-Labs/rvlt-flow/actions/workflows/build-image.yml/badge.svg)](https://github.com/RVLT-Labs/rvlt-flow/actions/workflows/build-image.yml)

### Equipment & Rental Management for Production Companies

Stop wrestling with spreadsheets and generic inventory tools.\
RVLT Flow is built from the ground up for AV, theatre, and live event companies\
who need to track gear, manage projects, and run a warehouse — not fight their software.

[Get Started](#-getting-started) · [Features](#-what-you-get) · [Tech Stack](#%EF%B8%8F-tech-stack) · [Environment Variables](#-environment-variables)

</div>

---

## The Problem

Production companies live and die by their gear. You need to know what's available, where it is, who has it, and when it's coming back — across dozens of projects running simultaneously. Most teams end up duct-taping together spreadsheets, whiteboards, and half-forgotten text messages.

RVLT Flow replaces all of that with a single platform that handles the **entire equipment lifecycle**: from the moment gear arrives in your warehouse to the moment it's checked back in, tested, and shelved for the next show.

---

## What You Get

### Inventory That Actually Works
Track every piece of gear with auto-generated asset tags, QR codes, and full lifecycle status. Handle both **serialized assets** (individual items like a console or projector) and **bulk assets** (cables, clamps, gaff tape) with stock levels and reorder alerts. Group gear into **Kits** — road cases and racks that check out as a single unit with one scan. Attach photos, manuals, and documents to any item. Tag everything with free-form labels for fast filtering. Import and export via CSV when you need to move data in bulk.

### Project & Rental Lifecycle
Take a project from **Enquiry → Quote → Confirmed → Checked Out → On Site → Returned → Invoiced**. Add line items for equipment, labour, transport, and services with per-day, weekly, flat, or hourly pricing. Drag-and-drop line item groups keep quotes organized. Real-time **availability checking** warns you before you double-book, with reduced-stock detection for gear that's in maintenance or marked lost. Overbooking is allowed with explicit confirmation when you need to make it work anyway. Save any project as a **template** to reuse equipment lists on future shows.

### Project Services & Scheduling
Attach structured operational tasks to projects — **deliveries, pickups, bump in/out, labour calls, and more**. Each service has its own status flow, date/time, location, and crew assignments. Create service templates so your standard show workflow is one click away. Services auto-sync with line items and crew schedules.

### Crew Management
Manage your team of **employees, freelancers, contractors, and volunteers** with roles, skills, and certification tracking. Assign crew to project services and see everyone's availability on a **14-day Gantt-style planner**. Send offers, track acceptances, log timesheets with approval workflows, and generate **Call Sheet PDFs**. Each crew member gets a personal **iCal feed** they can subscribe to. Expiring certifications trigger automatic notifications.

### Warehouse Floor, Meet Your Phone
Your crew gets a **PWA with barcode scanning** — scan an asset tag, hear the chime, move on. Check out to projects, check in with condition tracking (Good / Damaged / Missing). Pull sheets give pickers an interactive checklist. Kit barcodes check out the entire container and all its contents in one scan. Conflict detection blocks checkout if an asset is already out on another project. Works on any phone with a camera — no app store required.

### Professional Documents in Seconds
Generate **Quotes, Invoices, Packing Lists, Return Sheets, and Delivery Dockets** as polished PDFs with your org logo, grouped line items, kit breakdowns, line item notes, and overbooking badges. Kit contents render as indented children across all document types. Ready to email to clients or hand to the warehouse.

### Test & Tag Compliance (AS/NZS 3760:2022)
Full equipment register with visual inspection and electrical test records — earth continuity, insulation resistance, leakage current, polarity, and RCD trip time. Track test intervals per equipment class, get notified when items are due, and generate **10 report types** including full register, overdue items, test session logs, item history, due schedule, tester activity, and compliance certificates in PDF and CSV.

### Maintenance & Repairs
Schedule and track repairs, preventative maintenance, firmware updates, inspections, and cleaning across multiple assets in a single record. Track status from Scheduled through to Completed with pass/fail/conditional results. Overdue items surface automatically in your notification center.

### Clients, Suppliers & Locations
Manage **clients** (companies, individuals, venues, production houses) with contact details, billing info, and payment terms. Keep a **supplier directory** for purchase tracking and subhire, with full purchase order workflows from draft through to received. Organize **locations** in a hierarchy — warehouses, venues, vehicles, offsite storage — with address autocomplete, **interactive maps**, and get-directions links.

### Teams & Permissions
Multi-tenant from day one. Each organization gets isolated data, configurable branding, and a role hierarchy — **Owner, Admin, Manager, Member, Viewer** — with granular permissions across 14 resource types. Two-factor authentication with backup codes, passkey support, team invitations, and a full audit trail logging every write operation. Export and import entire organizations for backup or migration.

### Dashboard & Notifications
A live dashboard shows active projects, asset counts, upcoming shows, and recent activity. The **notification center** surfaces overdue returns, upcoming projects, maintenance due, low stock alerts, pending crew offers, expiring certifications, and submitted timesheets — so nothing slips through the cracks.

### Search That Gets Out of Your Way
A global command palette searches across every entity type. Type `@` to jump to any page with drill-down into children. Type a date to open the availability calendar. Use `/` for slash commands. Full keyboard navigation with `Shift+arrows`, `Tab`, and `Escape`.

### Mobile-First PWA
Installable on iOS and Android home screens. Proper safe area handling for notch, Dynamic Island, and home indicator. Bottom navigation with quick access to Home, Assets, Scan, Projects, and Warehouse. Touch-optimized with 44px minimum tap targets and responsive tables that progressively hide columns on smaller screens.

### Site Administration
A dedicated **admin panel** for platform-wide management — create and manage organizations, promote or ban users, force-disable 2FA, configure registration policies (open, invite-only, or disabled), set global tax rates and currency, and customize platform branding with your own name, icon, and logo.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** — App Router, Turbopack |
| Language | **TypeScript** — strict mode |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Radix for overlays, Base UI for sidebar/breadcrumb) |
| Database | **Convex** (sole copy of domain data) + **PostgreSQL/Prisma v7** for Better Auth + activity log |
| Auth | **Better Auth** — Organizations, 2FA, Passkeys, Admin |
| State | **Convex** `useQuery`/`useMutation` (reactive) + **React Hook Form** + **Zod** |
| PDF | **pdfme** (`@pdfme/generator` + custom plugins) |
| Storage | **Convex file storage** |
| Email | **Resend** |
| PWA | **@ducanh2912/next-pwa** |
| Maps | **Google Maps** (`@vis.gl/react-google-maps`) |

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **pnpm** (this repo is pnpm-only — a committed `pnpm-lock.yaml` is the single lockfile)
- **Docker** (recommended — for PostgreSQL) or bring your own Postgres

### 1. Clone & install

```bash
git clone https://github.com/RVLT-Labs/rvlt-flow.git
cd rvlt-flow
pnpm install
```

### 2. Start the database & file storage

The included Docker Compose file spins up everything you need:

```bash
cd docker-db
docker compose up -d
cd ..
```

This gives you:

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL | `localhost:5432` | `postgres` / `postgres` / db: `gearflow` |

File uploads are stored in **Convex file storage** — no S3/MinIO bucket to create.

### 3. Configure your environment

Create a `.env` file in the project root. Here's a working local setup:

```env
# ── Database ──────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gearflow"

# ── Auth ──────────────────────────────────────────────────
BETTER_AUTH_SECRET="change-me-to-a-random-64-char-string"
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# ── Email ─────────────────────────────────────────────────
RESEND_API_KEY="re_your_api_key"
EMAIL_FROM="onboarding@resend.dev"

# ── Maps ──────────────────────────────────────────────────
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="your-google-maps-api-key"

# ── Convex (primary backend for all domain data) ─────────
CONVEX_DEPLOY_KEY="your-convex-deploy-key"
NEXT_PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud"

# ── Admin Bootstrap ───────────────────────────────────────
SITE_ADMIN_REGISTRATION_ENABLED="true"
SITE_ADMIN_SECRET_TOKEN="pick-a-secret-token"
```

> **Tip:** Get a free Resend API key at [resend.com](https://resend.com). During development you can use their sandbox domain.

### 4. Set up Convex

RVLT Flow uses [Convex](https://convex.dev) as the primary datastore for all
domain data (assets, projects, warehouse, etc.) — Postgres only holds Better
Auth and the audit log. Create a Convex project, then push the schema/functions:

```bash
pnpm exec convex dev --once
```

### 5. Set up Postgres (Better Auth + activity log)

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

### 6. Launch

```bash
pnpm dev
```

Open [localhost:3000](http://localhost:3000) and register your first account.

To make yourself a **site admin**, visit:
```
http://localhost:3000/register/admin?token=pick-a-secret-token
```
(Use whatever token you set in `SITE_ADMIN_SECRET_TOKEN`.)

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Session encryption key — use a long random string |
| `BETTER_AUTH_URL` | Base URL for auth callbacks (`http://localhost:3000` for dev) |
| `NEXT_PUBLIC_APP_URL` | Public-facing app URL |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) |
| `EMAIL_FROM` | Sender email address |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key (Maps JavaScript API + Places API (New)) |
| `CONVEX_DEPLOY_KEY` | Convex Cloud deploy key |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL the app connects to |

### Optional

| Variable | Description |
|---|---|
| `UPLOAD_MAX_SIZE_MB` | Max file upload size (default: `50`) |
| `PASSKEY_RP_ID` | WebAuthn relying party ID |
| `PLATFORM_NAME` | Custom platform display name |
| `SITE_ADMIN_REGISTRATION_ENABLED` | Enable admin registration route (`true` / `false`) |
| `SITE_ADMIN_SECRET_TOKEN` | Token for `/register/admin?token=...` |

---

## Development Commands

```bash
pnpm dev                                  # Dev server with Turbopack
pnpm build                                # Production build + type check
pnpm lint                                 # ESLint
pnpm test                                 # Run unit tests (Vitest)
pnpm test:coverage                        # Unit tests with coverage report
pnpm test:integration                     # Integration tests

pnpm exec prisma migrate dev --name <name> # Create + apply a migration
pnpm exec prisma generate                 # Regenerate Prisma client
pnpm exec prisma studio                   # Browse your data in the browser
```

### Project Structure

```
convex/                    # Primary backend — domain data, mutations, queries
├── schema.ts              # Convex table definitions
└── *.ts / *Writes.ts      # Queries + browser-direct mutations, per domain

src/
├── app/
│   ├── (auth)/            # Login, register, onboarding
│   ├── (app)/             # Main app behind auth
│   │   ├── dashboard/     # Overview & activity
│   │   ├── assets/        # Inventory management
│   │   ├── projects/      # Rental lifecycle
│   │   ├── warehouse/     # Check out / check in
│   │   ├── kits/          # Container management
│   │   ├── maintenance/   # Repairs & scheduling
│   │   ├── test-and-tag/  # Compliance testing
│   │   ├── clients/       # Client directory
│   │   ├── suppliers/     # Vendor directory
│   │   ├── crew/          # Crew management
│   │   └── settings/      # Org config & team
│   └── (admin)/           # Site admin panel
├── components/            # React components
├── lib/                   # Auth, validation, utilities
├── server/                # Server actions — permanent carve-outs only
│                          # (auth, SSO, webhooks, site admin — not domain CRUD)
└── generated/             # Prisma client (auto-generated, gitignored)
```

---

## Governance & Documentation

This repository is governed by [`POLICY.md`](./POLICY.md) — the Codebase Management &
Hygiene Policy (RFC-2119 rules, threshold registry, audit procedure).

- **Policy profile: `WEB`** (R-0.1) — production web/app service. No payment provider,
  so §8.5 Billing is N/A.
- **Contributing:** see [`CONTRIBUTING.md`](./CONTRIBUTING.md) — toolchain, branching,
  commit rules, and the declared naming conventions (R-3.9).
- **Exceptions:** temporary, expiring deviations are recorded in
  [`docs/exceptions.md`](./docs/exceptions.md) (§15).
- **Audits:** compliance audits live in [`docs/audits/`](./docs/audits/) (R-14.2). The
  current baseline is `docs/audits/2026-07-18-hygiene-policy-baseline-audit.md`.

**Where further docs live:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) (overview + links),
[`FEATUREDOCS/`](./FEATUREDOCS/) (per-feature docs), [`CLAUDE.md`](./CLAUDE.md) (agent/dev
conventions), [`DESIGN.md`](./DESIGN.md) (design system), and [`docs/`](./docs/) (designs,
roadmap, runbooks, audits).

### Budget registry (R-0.4)

This repo **accepts the POLICY.md §13 threshold defaults**, with the following registered
overrides and project-specific (§13B) values:

| Threshold | Value | Rationale |
|---|---|---|
| T-5 Coverage | **48% floor** (default 80%) | Honest current baseline (~49–50%) over the declared scope, **enforced in CI as a ratchet** (`test:coverage`); climbing toward 80%. |
| T-7 Core Web Vitals p75 | **default** (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) | Accept the §13 default. **Alerted in PostHog** at 80% of each bound (LCP 2000 ms / INP 160 ms / CLS 0.08) via the "CWV p75 — LCP/INP/CLS" insights + alerts on `$web_vitals`; bundle-size half of R-8.1.5 enforced in CI (`bundle-ratchet`, blocking). |
| T-8 Route JS/CSS budget | **default** (≤ 170 KB soft, 300 KB hard) | Accept the §13 default; **enforced in CI as a blocking ratchet** (`bundle-ratchet.mjs`, R-8.1.5). |
| T-9 Interactive query latency | **default** (p95 < 100 ms; > 1 s = incident) | Accept the §13 default for interactive request paths. |
| T-P1 Audit-log retention | **2 years** | Activity log (`activityLogs`) retained 24 months for operational/dispute history. |
| T-P2 PII retention | **Active relationship + 12 months** *(confirmed 2026-07-22)* | Client/crew/user PII kept for the active business relationship, purged 12 months after account/org deletion. Deletion path tracked in R-8.12.2. |
| T-P3 Backup retention | **90 days** | Daily Convex export retained 90 days (`.github/workflows/convex-backup.yml`). |
| T-P4 Monthly cost budget (metered) | **Maps $15 · Resend $15 · Convex plan cap** *(confirmed 2026-07-22)* | Ceilings for the metered vendors; alert at 80% (R-9.12). |
| T-P5 Max flaky-quarantine size | **10 tests** | Quarantine caps at 10; beyond that the suite is failing, not flaky. |
| T-P6 Per-endpoint p95 SLOs | **300 ms API · 1 s page** | Interactive-endpoint targets; breach alerting tracked in R-9.11/R-8.9.6. |
| T-P7 Queue lag/age alert | **> 5 minutes** | Alert when the webhook/notification queue lags beyond 5 min; tracked in R-9.10. |

Values marked ⚠ *provisional* satisfy the R-0.4 registration requirement but carry business/legal
judgment — the owner should confirm them. Registration binds the value; several rules still require
the *enforcement* to be wired (alerting/monitoring), tracked as their own findings.

---

## License

RVLT Flow is source-available under the [Business Source License 1.1](./LICENSE).

**You can** freely use, modify, and self-host RVLT Flow — including for commercial purposes (e.g., running your own rental business).

**You cannot** offer RVLT Flow as a hosted or managed service to third parties.

Each version converts to [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) four years after its release.

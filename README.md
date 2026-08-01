<!-- Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5) -->
<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/rvlt-flow-wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/rvlt-flow-wordmark-light.svg">
  <img src="docs/brand/rvlt-flow-wordmark-dark.svg" alt="RVLT Flow" width="320">
</picture>

**Ops software for live event production.**

Jobs, crew, warehouse, gear, compliance — one system, built from the actual job flow.

[![Build & Deploy](https://github.com/TwoToned/gearflow/actions/workflows/build-image.yml/badge.svg)](https://github.com/TwoToned/gearflow/actions/workflows/build-image.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-E0363D)](./LICENSE)

[Getting started](#getting-started) · [Architecture](./ARCHITECTURE.md) · [Contributing](./CONTRIBUTING.md) · [Design system](./DESIGN.md)

</div>

---

Production companies live and die by their gear. What's available, where it is, who has it,
when it's back — across a dozen shows running at once. Most teams run that on spreadsheets,
a whiteboard, and a group chat nobody reads.

RVLT Flow covers the whole lifecycle instead: gear lands in the warehouse, goes out on a job,
comes back, gets tested, gets shelved. Quotes, dockets and invoices fall out of the same data,
so the paperwork matches the truck.

Running in production at **[flow.rvlt.app](https://flow.rvlt.app)**.

## What's in it

| | |
|---|---|
| **Inventory** | Serialised and bulk assets, auto asset tags, QR codes, kits that check out as one scan, photos and manuals, CSV in/out |
| **Jobs** | Enquiry → quote → confirmed → out → on site → returned → invoiced. Availability checks that warn before you double-book. Templates for repeat shows |
| **Services & scheduling** | Deliveries, pickups, bump in/out, labour calls — each with its own status, times, location and crew |
| **Crew** | Employees, freelancers, contractors. Skills, certs, offers, timesheets, a 14-day planner, call sheets, personal iCal feeds |
| **Warehouse** | PWA with barcode scanning. Check out, check in with condition, pull sheets, conflict blocking. Any phone with a camera |
| **Documents** | Quotes, invoices, packing lists, return sheets, delivery dockets — rendered once, stored, streamed. Never re-rendered on download |
| **Test & tag** | AS/NZS 3760:2022 register, electrical test records, due schedules, 10 report types, compliance certificates |
| **Maintenance** | Repairs, preventative work, firmware, inspections. Overdue items surface themselves |
| **Directories** | Clients, suppliers with purchase orders and subhire, locations with maps and directions |
| **Teams** | Multi-tenant. Owner / Admin / Manager / Member / Viewer, granular permissions, 2FA, passkeys, full audit trail |
| **Agent API** | REST + MCP + OAuth 2.1 over the same dispatcher, scoped to the calling user's own role. Mira answers in-app through it too |

Per-feature detail lives in [`FEATUREDOCS/`](./FEATUREDOCS/); [`ARCHITECTURE.md`](./ARCHITECTURE.md) is the map.

## Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** — App Router, Turbopack |
| Language | **TypeScript** — strict |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Radix for overlays, Base UI for sidebar/breadcrumb) |
| Data | **Convex** — sole copy of domain data. **PostgreSQL/Prisma v7** for Better Auth + activity log only |
| Auth | **Better Auth** — organizations, 2FA, passkeys, admin |
| Forms | **React Hook Form** + **Zod** |
| PDF | **pdfme** + custom plugins |
| Storage | **Convex file storage** |
| Email · Maps · Analytics | **Resend** · **Google Maps** · **PostHog** |

## Getting started

**You'll need** Node.js 20+, **pnpm** (this repo is pnpm-only — one committed `pnpm-lock.yaml`;
`npm`/`npx` will drift it), Docker or your own Postgres, and a [Convex](https://convex.dev) project.

```bash
git clone https://github.com/TwoToned/gearflow.git
cd gearflow
pnpm install

docker compose -f docker-db/docker-compose.yml up -d   # Postgres on :5432
```

Then create `.env` in the project root:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gearflow"

BETTER_AUTH_SECRET="change-me-to-a-random-64-char-string"
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

RESEND_API_KEY="re_your_api_key"          # unset = emails log to the console
EMAIL_FROM="onboarding@resend.dev"
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="your-google-maps-api-key"

CONVEX_DEPLOY_KEY="your-convex-deploy-key"
NEXT_PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud"

SITE_ADMIN_REGISTRATION_ENABLED="true"
SITE_ADMIN_SECRET_TOKEN="pick-a-secret-token"
```

Push the backend, migrate Postgres, go:

```bash
pnpm exec convex dev --once      # Convex schema + functions (domain data lives here)
pnpm exec prisma migrate deploy  # Better Auth + activity log
pnpm exec prisma generate
pnpm dev
```

[localhost:3000](http://localhost:3000) — register, then make yourself a site admin at
`/register/admin?token=` + whatever you put in `SITE_ADMIN_SECRET_TOKEN`.

Uploads go to Convex file storage. There's no bucket to create.

> The full environment variable list — Xero, PostHog sourcemaps, DB connection hardening,
> passkey RP, upload caps — is documented in [`CLAUDE.md`](./CLAUDE.md#environment-variables).

## Commands

```bash
pnpm dev              # Dev server (Turbopack)
pnpm build            # Production build + type check
pnpm lint             # ESLint
pnpm test             # Unit tests (Vitest)
pnpm test:coverage    # Unit tests + coverage ratchet
pnpm test:integration # Integration tests

pnpm exec prisma migrate dev --name <name>   # Create + apply a migration
pnpm exec prisma studio                      # Browse the auth/audit tables
pnpm run api:registry                        # Regenerate the API/MCP contract registry
```

### Layout

```
convex/            # Primary backend — schema, queries, *Writes.ts mutations
src/
├── app/
│   ├── (auth)/    # Login, register, onboarding
│   ├── (app)/     # The app — dashboard, assets, projects, warehouse, kits,
│   │              #   maintenance, test-and-tag, clients, suppliers, crew, settings
│   ├── (admin)/   # Site admin panel
│   └── api/       # v1 agent API, MCP, OAuth, webhooks, document streaming
├── components/    # React components
├── lib/           # Auth, validation, API dispatcher, utilities
├── server/        # Server actions — permanent carve-outs only, not domain CRUD
└── generated/     # Prisma client (gitignored)
```

## Governance

This repo is governed by [`POLICY.md`](./POLICY.md) — RFC-2119 rules, numbered and enforced.
Profile is **`WEB`** (R-0.1); §8.5 Billing is N/A (no payment provider).

| | |
|---|---|
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Toolchain, branching, commits, naming conventions (R-3.9) |
| [`docs/budgets.md`](./docs/budgets.md) | Budget & threshold registry (R-0.4) — coverage, CWV, bundle, latency, retention, rate limits |
| [`docs/exceptions.md`](./docs/exceptions.md) | Dated, expiring deviations (§15) |
| [`docs/audits/`](./docs/audits/) | Compliance audits (R-14.2) |
| [`CLAUDE.md`](./CLAUDE.md) | Agent + dev conventions, full env var reference |
| [`DESIGN.md`](./DESIGN.md) | Design system — read before any visual change |

## License

Source-available under the [Business Source License 1.1](./LICENSE).

Use it, modify it, self-host it — including to run your own rental business. You just can't
offer RVLT Flow as a hosted service to third parties. Each version converts to
[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) four years after release.

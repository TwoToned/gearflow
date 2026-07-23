# Project Structure

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

> Directories are documented at directory-grain, not file-by-file — a
> per-file enumeration goes stale every time a file is added, renamed, or
> moved (which is exactly what happened to the previous version of this
> doc after the Convex migration). For the domain-write security model and
> the definitive list of permanent server-action carve-outs, see
> [FEATUREDOCS/54-convex-data-layer.md](./54-convex-data-layer.md) — don't
> duplicate that list here.

```
convex/                  # PRIMARY domain/business data layer (Convex Cloud)
├── schema.ts             # All domain table definitions (103 tables)
├── lib/                  # Shared guards/helpers: availabilityCore, moneyGuards,
│                          # orgRef, writeGuard, blockingCommentsGate, counters, etc.
├── <domain>.ts            # Queries per domain (assets, projects, kits, crew, ...)
├── <domain>Writes.ts       # Browser-direct mutations per domain (the write
│                          # security boundary — see FEATUREDOCS/54)
└── *.test.ts              # ~100+ Convex-side unit/integration tests

src/
├── app/
│   ├── (auth)/            # Public pages: login, register, onboarding, invite
│   ├── (app)/             # Protected pages: dashboard, assets, projects, warehouse,
│   │                      # kits, crew, clients, suppliers, maintenance, test-and-tag,
│   │                      # locations, availability, check, activity, settings, account
│   ├── (admin)/           # Site admin panel
│   ├── warehouse/         # Public/token-based warehouse display routes
│   ├── auditor/           # T&T auditor-token routes
│   ├── offline/           # PWA offline fallback page
│   ├── api/               # API routes: auth, files, uploads, documents, crew,
│   │                      # calendar, integrations (WooCommerce webhook ingress
│   │                      # is a Convex httpAction, not a Next.js route — see
│   │                      # FEATUREDOCS/35), admin-register, cron
│   ├── layout.tsx         # Root layout: fonts, theme, DomPatch, GlobalErrorBoundary,
│   │                      # OverlayLockReset, toaster (see CLAUDE.md "DOM Safety")
│   └── globals.css        # Theme variables, base styles, iOS PWA fixes
├── components/            # React components, one directory per domain
│                          # (assets, projects, kits, crew, warehouse, collaboration,
│                          # roi, custom-fields, brand, dashboard, ui, layout, ...)
├── hooks/                 # use-authed-query (Convex reads), use-*-writes
│                          # (Convex mutations per domain), use-mobile, etc.
├── lib/
│   ├── auth.ts / auth-client.ts / auth-server.ts   # Better Auth server/client config
│   ├── org-context.ts     # getOrgContext, requireRole, requirePermission (server-action
│   │                      # carve-outs only — Convex RBAC lives in convex/lib/)
│   ├── convex-client.ts / convex-token-fetch.ts / convex-auth.ts  # Convex client wiring
│   ├── *-read.ts          # Service-token Convex readers for non-browser contexts
│   │                      # (PDF generation, public API, email senders) — see
│   │                      # FEATUREDOCS/54 "Reads"
│   ├── storage.ts         # S3/MinIO: uploadToS3, getFromS3, deleteFromS3
│   ├── validations/       # Zod schemas: asset, model, kit, project, client, etc.
│   ├── pdfme/              # pdfme PDF generation: plugins, section-renderer, templates
│   └── db-url.ts           # DB connection hardening (statement timeout, pool limits)
├── server/                 # Server actions — PERMANENT carve-outs only (auth/crypto,
│                           # HMAC/external API, email/iCal, CSV/Node — full list in
│                           # FEATUREDOCS/54). NOT a place for new domain CRUD; new
│                           # entities get a Convex table + *Writes.ts mutations instead.
├── generated/prisma/       # Prisma generated client (gitignored, run `npx prisma generate`)
└── middleware.ts           # Auth check, route protection

prisma/schema.prisma        # Better Auth + audit models ONLY (16 models) — the
                             # domain schema lives in convex/schema.ts instead
```

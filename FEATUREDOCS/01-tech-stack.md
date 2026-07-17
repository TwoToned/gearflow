# Technology Stack & Configuration

## Core Dependencies
| Component | Package | Version Context |
|-----------|---------|----------------|
| Framework | Next.js 16 | App Router, Turbopack, React 19 |
| Language | TypeScript | Strict mode enabled |
| CSS | Tailwind CSS v4 | oklch color space, `@theme inline` |
| UI Library | shadcn/ui v4 | Radix (`@radix-ui/react-*`) for overlays (`asChild`), Base UI (`@base-ui/react`) for sidebar/breadcrumb (`render`) — see FEATUREDOCS/07 |
| Database | Convex | Sole copy of all domain data + uploaded file bytes — see FEATUREDOCS/54 |
| Database (auth) | PostgreSQL + Prisma v7 | Better Auth + activity-log only, 16 models, client generated to `src/generated/prisma/` |
| Auth | Better Auth | Organization, TwoFactor, Admin, Passkey plugins |
| State Management | Convex `useQuery`/`useMutation` | Reactive, live-updating subscriptions — no polling, no manual cache invalidation |
| Forms | React Hook Form + Zod | `zodResolver()`, `z.input<>` for types |
| PDF | pdfme (@pdfme/generator + custom plugins) | Helvetica only, no Unicode. pdf.js for client-side preview |
| Storage | Convex file storage (`_storage`) | Per-org access records; `storage.ts` keeps S3-era API names |
| Email | Resend SDK | Invitations, password reset, notifications |
| Icons | lucide-react | 180+ icons, dynamic icon component |
| PWA | @ducanh2912/next-pwa | Offline fallback, service worker |
| Toast | Sonner | `toast.success()`, `toast.error()` |
| Themes | next-themes | Dark mode default, `ThemeProvider` |

## Environment Variables
```
DATABASE_URL              # PostgreSQL connection string (Better Auth + activity log)
BETTER_AUTH_SECRET        # Session encryption key
CONVEX_DEPLOY_KEY         # Convex Cloud deploy key
NEXT_PUBLIC_CONVEX_URL    # Convex deployment URL the app connects to
CONVEX_AUTH_ISSUER        # Better Auth issuer Convex trusts for JWTs
CONVEX_AUTH_JWKS_URL      # JWKS endpoint Convex fetches to verify tokens
RESEND_API_KEY            # Email provider
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY  # Maps JavaScript API + Places API (New)
SITE_ADMIN_REGISTRATION_ENABLED  # "true" to enable admin signup
SITE_ADMIN_SECRET_TOKEN   # Token for /register/admin?token=...
PASSKEY_RP_ID             # WebAuthn relying party ID (e.g. localhost, rvlt.app)
```

## Key Config Files
- `next.config.ts` — Turbopack, PWA config via `@ducanh2912/next-pwa`
- `convex/schema.ts` — Domain database schema (100+ tables) — the primary schema
- `prisma/schema.prisma` — Better Auth + activity-log schema only (16 models)
- `public/manifest.json` — PWA manifest (standalone, icons, theme)
- `src/app/layout.tsx` — Root layout with viewport config, fonts, providers
- `src/app/globals.css` — Tailwind imports, oklch theme variables, iOS PWA fixes

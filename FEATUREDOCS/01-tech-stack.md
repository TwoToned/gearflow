# Technology Stack & Configuration

## Core Dependencies
| Component | Package | Version Context |
|-----------|---------|----------------|
| Framework | Next.js 16 | App Router, Turbopack, React 19 |
| Language | TypeScript | Strict mode enabled |
| CSS | Tailwind CSS v4 | oklch color space, `@theme inline` |
| UI Library | shadcn/ui v4 | Base UI primitives (`@base-ui/react`), NOT Radix |
| Database | PostgreSQL + Prisma v6 | Client generated to `src/generated/prisma/` |
| Auth | Better Auth | Organization, TwoFactor, Admin plugins |
| State Management | React Query | 60s stale time, no refetchOnWindowFocus |
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
DATABASE_URL              # PostgreSQL connection string
BETTER_AUTH_SECRET        # Session encryption key
RESEND_API_KEY            # Email provider
SITE_ADMIN_REGISTRATION_ENABLED  # "true" to enable admin signup
SITE_ADMIN_SECRET_TOKEN   # Token for /register/admin?token=...
PASSKEY_RP_ID             # WebAuthn relying party ID (e.g. localhost, rvlt.app)
```

## Key Config Files
- `next.config.ts` — Turbopack, PWA config via `@ducanh2912/next-pwa`
- `prisma/schema.prisma` — Full database schema
- `public/manifest.json` — PWA manifest (standalone, icons, theme)
- `src/app/layout.tsx` — Root layout with viewport config, fonts, providers
- `src/app/globals.css` — Tailwind imports, oklch theme variables, iOS PWA fixes

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
| Storage | AWS SDK (S3/MinIO) | Org-prefixed file paths |
| Email | Resend SDK | Invitations, password reset, notifications |
| Icons | lucide-react | 180+ icons, dynamic icon component |
| PWA | @ducanh2912/next-pwa | Offline fallback, service worker |
| Toast | Sonner | `toast.success()`, `toast.error()` |
| Themes | next-themes | Dark mode default, `ThemeProvider` |

## Environment Variables
```
DATABASE_URL              # PostgreSQL connection string
BETTER_AUTH_SECRET        # Session encryption key
S3_ACCESS_KEY_ID          # AWS/MinIO access key
S3_SECRET_ACCESS_KEY      # AWS/MinIO secret key
S3_REGION                 # Default: ap-southeast-2
S3_ENDPOINT               # MinIO endpoint (omit for AWS)
S3_BUCKET                 # Default: gearflow-uploads
RESEND_API_KEY            # Email provider
SITE_ADMIN_REGISTRATION_ENABLED  # "true" to enable admin signup
SITE_ADMIN_SECRET_TOKEN   # Token for /register/admin?token=...
GOOGLE_CLIENT_ID          # Google OAuth (optional)
GOOGLE_CLIENT_SECRET      # Google OAuth (optional)
MICROSOFT_CLIENT_ID       # Microsoft OAuth (optional)
MICROSOFT_CLIENT_SECRET   # Microsoft OAuth (optional)
PASSKEY_RP_ID             # WebAuthn relying party ID (e.g. localhost, gearflow.com)
```

## Key Config Files
- `next.config.ts` — Turbopack, PWA config via `@ducanh2912/next-pwa`
- `prisma/schema.prisma` — Full database schema
- `public/manifest.json` — PWA manifest (standalone, icons, theme)
- `src/app/layout.tsx` — Root layout with viewport config, fonts, providers
- `src/app/globals.css` — Tailwind imports, oklch theme variables, iOS PWA fixes

# ADR-0002: Adopt next/image but serve app images unoptimized

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Status:** Accepted (2026-07-18)

## Context

POLICY.md **R-8.1.4** (WEB profile, §8.1) requires the framework's optimizing image
primitive (`next/image`) rather than raw `<img>` — for enforced dimensions (CLS), default
lazy-loading, and modern-format optimization. The app rendered user-facing images with raw
`<img>` (each with an `eslint-disable @next/next/no-img-element`).

Every user-facing image in this app comes from a source the Next.js **image optimizer cannot
process**:

- **Auth-gated proxy.** Uploaded images are served from `/api/files/{storageId}`, which calls
  `requireOrganization()` and 401s without a session, then org-scopes the file
  (`src/app/api/files/[...path]/route.ts`). Next's optimizer fetches the source URL
  **server-side, without the user's session cookie**, so an optimized fetch would 401 and
  render a broken image.
- **`blob:` object URLs** — client-side upload previews (`URL.createObjectURL`) aren't
  fetchable server-side.
- **`data:` URLs** — e.g. the generated 2FA QR code; there is nothing to optimize.

Enabling optimization would therefore break images, and there is no safe remote host to
allow-list (the proxy is intentionally private).

## Decision

Adopt `next/image` everywhere via a thin wrapper, **`AppImage`** (`src/components/ui/app-image.tsx`),
that sets `unoptimized` by default. This keeps the R-8.1.4 wins that ARE achievable —
enforced `width/height` or `fill` (CLS) and default lazy-loading below the fold — while
bypassing the server optimizer that the auth-gated/blob/data sources can't support.

Genuinely static/public assets (none today) should use `next/image` directly so they DO get
optimized.

## Consequences

- All raw `<img>` tags and their `eslint-disable` suppressions are removed; image handling is
  standardized through one primitive.
- Modern-format/resize optimization is intentionally **not** applied to these dynamic images.
  Revisit if image serving moves to unguessable public URLs (no per-request auth), at which
  point `AppImage` could drop `unoptimized` and add `images.remotePatterns`.
- `fill` usages require a positioned (`relative`) parent; the four affected containers were
  updated accordingly.

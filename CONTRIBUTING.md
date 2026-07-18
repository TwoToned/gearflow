# Contributing to RVLT Flow

This repo is governed by [`POLICY.md`](./POLICY.md) (Codebase Management & Hygiene
Policy). **Profile: `WEB`.** Every applicable `MUST` rule is a hard constraint on
merge (BUILD mode, §0). Read [`CLAUDE.md`](./CLAUDE.md) for architecture conventions
and the FEATUREDOCS index.

## Toolchain

- **Package manager: pnpm only** (single committed `pnpm-lock.yaml`; CI installs
  `--frozen-lockfile`). Use `pnpm` / `pnpm exec` — never `npm`/`npx`.
- **Convex:** always `pnpm exec convex …`, never `npx convex` (see CLAUDE.md).
- Setup: `pnpm install` → `pnpm exec prisma generate` → `pnpm dev`.

## Branching & commits (POLICY.md §2.2)

- **Never commit feature work to `main`.** Branch per feature/change; merge via PR to
  the protected default branch within the branch-age budget (T-16, 3 days).
- **Atomic commits** — one logical change each (R-2.7). The more focused, the better.
- **Conventional Commits** grammar (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, …) —
  this repo's history uses it and release tooling relies on it.
- **PRs ≤ 400 changed LOC** where practical (T-2), excluding generated/vendored/lockfile/
  migration/fixture files.
- **Docs update in the same PR** (R-5.2): any behaviour/interface/config change updates
  the affected FEATUREDOCS **and** CLAUDE.md in the same PR. Stale docs are defects.

## Naming conventions (POLICY.md R-3.9 / R-3.10 — declared here, lint-enforced where tooling exists)

One name per domain concept (R-3.10): the same entity uses the same term everywhere
(we say **client**, not "customer", for the renting party — `customer_*` appears only
in external WooCommerce payload fields).

| Artifact | Convention | Example |
|---|---|---|
| Files & directories | `kebab-case` | `address-input.tsx`, `line-items.ts` |
| Next.js route segments | framework convention | `warehouse/[projectId]/page.tsx` |
| Variables & functions | `camelCase` | `getOrgContext`, `lineItems` |
| React components | `PascalCase` | `AddressInput`, `ModelRoiTab` |
| Types / interfaces / classes | `PascalCase` | `DocumentLineItem`, `OrgContext` |
| Module-level constants | `SCREAMING_SNAKE_CASE` | `REDACTED_FIELDS`, `MAX_ATTEMPTS` |
| Convex tables & fields | `camelCase` | `bulkAssets`, `organizationId` |
| Postgres tables & columns | `snake_case` (Prisma `@@map`) | `activity_logs`, `crew_role` |
| Environment variables | `SCREAMING_SNAKE_CASE`; client-exposed prefixed `NEXT_PUBLIC_` | `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_APP_URL` |
| Booleans / predicates | read as assertions | `isActive`, `hasAccess` |
| Values with units | unit in the name/type | `timeoutMs`, `UPLOAD_MAX_SIZE_MB` |

Naming, complexity, and length rules are wired at **warn** level in
`eslint.config.mjs` (a burn-down baseline, not yet a blocking gate — see the audit at
`docs/audits/`). Do not add *new* violations.

## Before you open a PR

Run locally (CI runs the same, plus a brand guard):

```bash
pnpm lint          # ESLint
pnpm exec tsc --noEmit   # Type check (zero errors)
pnpm test          # Unit tests
```

- **New code needs tests in the same PR** (R-8.8.3).
- **No `any` / `@ts-ignore`** — use a described `@ts-expect-error` if truly unavoidable
  (R-8.2.2). Validate every trust boundary (HTTP body, form, webhook, vendor response)
  through a Zod/Convex schema (R-8.2.3).
- **Server is the authority** — authz, prices, and validation are server-side; the
  client is UX only (R-9.3).

## Exceptions

A temporary, justified deviation from a `MUST`/`SHOULD` requires a written, **expiring**
exception in [`docs/exceptions.md`](./docs/exceptions.md) (§15): rule ID, reason, scope,
owner, expiry date.

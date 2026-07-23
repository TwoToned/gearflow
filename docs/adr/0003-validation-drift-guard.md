# ADR-0003: Enforce Zod↔Convex validation single-source via a drift guard

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Status:** Accepted (2026-07-18)

## Context

POLICY.md **R-8.6.1** requires a single source of truth for validation. The app
validates the same business fields at two trust boundaries:

- **Client input** — Zod schemas in `src/lib/validations/*` (used by the form
  `zodResolver`). These are input-shaped: defaults, coercion, `.email()`, `.max()`,
  cross-field `.refine()`, `z.literal("")` unions.
- **Server args** — the `*Fields` `v.*` validator objects in `convex/*Writes.ts`, the
  browser-direct write boundary. These are structural and mostly optional.

The two are hand-maintained and can drift (a field added to one and not the other).

We evaluated mechanically deriving the Convex validators from the Zod schemas with
`convex-helpers`' `zodToConvexFields`. **It is not safe here:** the bridge does not
preserve optionality — fields with a Zod `.default()` or `.optional().or(...)` come out
**required**. Dropping those into the browser-direct mutations would make Convex reject
inputs it currently accepts — a live regression on the money/tenant write surface (the
exact surface where prior CRITICAL IDOR/money bugs were found). The two layers
legitimately differ in optionality, so a pure derivation is the wrong tool.

## Decision

Keep the two definitions but **enforce that they can never drift out of field-set
sync**, which is the guarantee R-8.6.1 actually needs. `convex/validationDrift.test.ts`
imports each Zod schema and its paired Convex `*Fields` object and asserts they carry
the **same field set**. Deliberate divergences (client-only form controls like
`generateShifts`; server-managed fields like `id`/`organizationId`/audit stamps/FK
snapshots) are documented per-pair via explicit `allow` lists. The `*Fields` objects are
`export`ed so the guard can introspect them. Twelve domains are covered today; new domains
are added to the `PAIRS` table.

## Consequences

- Adding/removing a field on one side without the other fails CI until reconciled —
  single-source-of-truth consistency is enforced with **zero runtime change** to the
  security-sensitive validators (no regression risk).
- The guard checks field-set parity, not per-field type/optionality equivalence (those
  differ by design between the layers). A future initiative could restructure each schema
  to make a safe, optionality-preserving derivation possible; until then this guard holds
  the invariant. See ADR rationale above for why the mechanical derivation was rejected.

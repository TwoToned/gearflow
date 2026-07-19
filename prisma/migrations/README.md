# Prisma migrations — policy (R-8.3.1)

**`prisma/schema.prisma` is the authoritative source of the Postgres schema.** Every
change to it MUST ship in the same PR as a migration under `prisma/migrations/`, enforced
by the CI **migration-drift gate** (`scripts/check-migration-drift.mjs`, run in the
Hygiene job): a PR that edits `schema.prisma` without adding a `migration.sql` fails.

Add one with:

```bash
pnpm exec prisma migrate dev --name <describe-the-change>
```

Escape hatch for a deliberate **non-datamodel** edit to `schema.prisma` (a comment, a
formatting change): put `[skip-migration-check]` in the PR's latest commit message.

## Known limitation (why there's no full replay gate)

A few early tables (e.g. `crew_role`) were created with `prisma db push` and never
captured as migrations, so the history is **not replayable from zero** — `next build` /
CI provision the DB with `prisma db push` (current schema) rather than `migrate deploy`.
Reconciling the history (capturing those tables into a baseline migration) needs the prod
schema and is tracked separately. Until then, the drift gate above prevents any **new**
divergence, which is the R-8.3.1 concern.

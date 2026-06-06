-- Reconcile pre-existing schema drift between schema.prisma and the migration
-- history. `prisma migrate dev` on the saved-views branch auto-detected these
-- constraints as missing from the DB even though schema.prisma has always
-- declared them — they were never emitted as a dedicated migration, so the DB
-- diverged. See TODOS.md "Pre-existing Prisma schema drift".
--
-- Hand-authored and applied via `prisma migrate deploy` (NOT `migrate dev`,
-- which would demand a full reset on a drifted DB). Every statement here is
-- idempotent-safe: re-running on an already-reconciled DB is a no-op.

-- 1. project_service.billableToClient
--    schema.prisma declares `Boolean @default(false)` (non-nullable), but the
--    column is nullable in the DB. Backfill any NULLs to false BEFORE adding
--    the NOT NULL constraint so the ALTER cannot fail on existing rows. The
--    column already carries the `false` DEFAULT, so application inserts never
--    produce NULLs — the backfill only catches pre-default historical rows.
--
--    Deploy-safety note: `SET NOT NULL` takes a brief ACCESS EXCLUSIVE lock and
--    scans the table to validate. project_service is a small operational table
--    (service line items; low thousands of rows at most), so that scan is on the
--    order of milliseconds and is bounded by the runtime statement_timeout
--    (DB_STATEMENT_TIMEOUT_MS, default 30s). The zero-downtime CHECK ... NOT
--    VALID / VALIDATE CONSTRAINT pattern is deliberately NOT used: Prisma runs
--    each migration in a single transaction, so the table stays locked until
--    commit regardless, and the split would add complexity without buying the
--    concurrency it normally provides. Revisit only if this table grows large.
UPDATE "project_service" SET "billableToClient" = false WHERE "billableToClient" IS NULL;
ALTER TABLE "project_service" ALTER COLUMN "billableToClient" SET NOT NULL;

-- 2. updatedAt is `@updatedAt` (application-managed, no DB default) on these
--    models, but the DB columns carry a stale DEFAULT. DROP DEFAULT is a no-op
--    when the default is already absent.
ALTER TABLE "group_template" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "project_category" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "project_group" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Refresh planner stats after the potential bulk UPDATE above (per CLAUDE.md's
-- bulk-data migration rule). No-op cost when 0 rows were touched.
ANALYZE "project_service";

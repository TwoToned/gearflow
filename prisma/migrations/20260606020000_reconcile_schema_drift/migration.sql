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
--    the NOT NULL constraint so the ALTER cannot fail on existing rows.
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

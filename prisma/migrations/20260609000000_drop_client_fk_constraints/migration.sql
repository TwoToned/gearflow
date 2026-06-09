-- Drop the FK constraints INTO the frozen Prisma `client` table.
--
-- Why: Clients were HARD-CUTOVER to Convex (the sole source of truth). New clients
-- are created ONLY in Convex; the Prisma `client` table is frozen at its
-- cutover-time rows (read only by the one-time backfill). The live FKs
--   project.clientId      -> client(id)   (nullable, NO ACTION)
--   client_media.clientId -> client(id)   (required, CASCADE)
-- therefore reject any net-new Convex-only client (the row has no Prisma `client`
-- to point at). clientId becomes a plain external id holding the Convex cuid —
-- matching how Convex itself stores FKs (v.string()). The columns + indexes stay;
-- only the constraints are dropped. See FEATUREDOCS/54.
--
-- IF EXISTS guards keep this idempotent across environments where the constraint
-- may already be absent.

ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_clientId_fkey";

ALTER TABLE "client_media" DROP CONSTRAINT IF EXISTS "client_media_clientId_fkey";

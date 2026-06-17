-- Drop the inbound FK constraint into the frozen Prisma `brand_template` table.
--
-- Why: Brand templates were inverted to Convex-only (Phase B of the Convex
-- domain-only decommission). New brand templates are created ONLY in Convex; the
-- Prisma `brand_template` table is no longer written. The live FK
--   document_template.brandTemplateId -> brand_template(id)  (nullable, SetNull)
-- would therefore reject any net-new Convex-only brand template (the row has no
-- Prisma `brand_template` to point at). brandTemplateId becomes a plain external
-- id holding the Convex cuid — matching how Convex itself stores FKs
-- (v.string()). The column + index stay; only the constraint is dropped. See the
-- decommission runbook + FEATUREDOCS/54.
--
-- IF EXISTS guard keeps this idempotent across environments where the constraint
-- may already be absent.

ALTER TABLE "document_template" DROP CONSTRAINT IF EXISTS "document_template_brandTemplateId_fkey";

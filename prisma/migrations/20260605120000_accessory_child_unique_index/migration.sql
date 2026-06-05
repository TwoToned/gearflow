-- Accessory child line items must be unique per parent line per accessory:
-- one serialised child per (parent, asset) and one bulk child per (parent,
-- bulkAsset). This closes the expansion race where two concurrent prep/checkout
-- scans both read "no child yet" and create duplicate rows (the read-before-create
-- idempotency in expandAccessoriesForAsset has no DB backstop on its own).
--
-- These are PARTIAL unique indexes (filtered on childKind = 'ACCESSORY'). Prisma's
-- schema DSL cannot express partial/filtered indexes, so they are raw-SQL only and
-- intentionally NOT mirrored in schema.prisma. A plain @@unique would over-constrain
-- top-level lines, kit members, and sub-hire children. `prisma migrate deploy`
-- (CI/prod) applies them as-is; on a local `prisma migrate dev`, if Prisma proposes
-- dropping them as "drift", keep them (discard that part of the generated migration).
--
-- If creation fails with a duplicate-key error, pre-existing duplicate accessory
-- rows exist (the bug this guards against) — investigate and dedup before retrying;
-- this migration does NOT delete data.

CREATE UNIQUE INDEX IF NOT EXISTS "project_line_item_accessory_serialised_key"
  ON "project_line_item" ("parentLineItemId", "assetId")
  WHERE "childKind" = 'ACCESSORY' AND "assetId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "project_line_item_accessory_bulk_key"
  ON "project_line_item" ("parentLineItemId", "bulkAssetId")
  WHERE "childKind" = 'ACCESSORY' AND "bulkAssetId" IS NOT NULL;

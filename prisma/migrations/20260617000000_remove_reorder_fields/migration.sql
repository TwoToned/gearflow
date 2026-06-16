-- Remove the low-stock reordering feature ("Reorder tab"): drop the
-- preferred-supplier FK + the reorder/last-reordered columns from bulk_asset.
--
-- These backed /warehouse/reorder (reorder candidate grouping + draft supplier
-- orders) and the low-stock notification/email path, all of which are removed.

ALTER TABLE "bulk_asset" DROP CONSTRAINT IF EXISTS "bulk_asset_preferredSupplierId_fkey";
DROP INDEX IF EXISTS "bulk_asset_preferredSupplierId_idx";
ALTER TABLE "bulk_asset" DROP COLUMN IF EXISTS "reorderThreshold";
ALTER TABLE "bulk_asset" DROP COLUMN IF EXISTS "preferredSupplierId";
ALTER TABLE "bulk_asset" DROP COLUMN IF EXISTS "lastReorderedAt";

ANALYZE "bulk_asset";

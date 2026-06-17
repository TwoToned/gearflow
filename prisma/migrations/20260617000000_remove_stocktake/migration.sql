-- Remove the Stocktake feature entirely.
-- Drops the stocktake + stocktake_item tables and their enum types.
-- AssetScanLog is intentionally NOT touched — it is not stocktake-owned.

DROP TABLE IF EXISTS "stocktake_item" CASCADE;
DROP TABLE IF EXISTS "stocktake" CASCADE;

DROP TYPE IF EXISTS "StocktakeItemResult";
DROP TYPE IF EXISTS "StocktakeStatus";
DROP TYPE IF EXISTS "StocktakeScope";

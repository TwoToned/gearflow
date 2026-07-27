-- WS11 (#950): sales line items.
--
-- Postgres lets you ADD VALUE on an existing enum without touching rows.
-- BEFORE/AFTER positioning mirrors the declared order in schema.prisma.

ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'SOLD';

ALTER TYPE "LineItemType" ADD VALUE IF NOT EXISTS 'SALE';

-- How a SALE line's stock was sourced. Never inferred.
CREATE TYPE "SaleMode" AS ENUM ('NEW_STOCK', 'FROM_RENTAL_STOCK');

ALTER TYPE "AllocationBasis" ADD VALUE IF NOT EXISTS 'EXCLUDED_SALE' BEFORE 'NO_REVENUE';

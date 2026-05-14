-- Wave 3 reorder dashboard: per-bulk-asset preferred supplier + last-reordered timestamp.
--
-- preferredSupplierId lets /warehouse/reorder group low-stock items by who
-- you'd actually buy them from. lastReorderedAt is populated by
-- createReorderDraft so the dashboard can show "ordered 12 days ago"
-- alongside current stock without scanning the full SupplierOrder history.

ALTER TABLE "bulk_asset"
  ADD COLUMN "preferredSupplierId" TEXT,
  ADD COLUMN "lastReorderedAt" TIMESTAMP(3);

ALTER TABLE "bulk_asset"
  ADD CONSTRAINT "bulk_asset_preferredSupplierId_fkey"
  FOREIGN KEY ("preferredSupplierId") REFERENCES "supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bulk_asset_preferredSupplierId_idx"
  ON "bulk_asset"("preferredSupplierId");

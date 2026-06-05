-- One-time backfill. Model-level equipment lines added BEFORE model-level
-- accessory expansion shipped never got their model's default accessories
-- (expandAccessoryChildren only ran for specific-asset adds). Expand them now so
-- they show on the project + documents, matching what a fresh add now produces.
--
-- Idempotent: the NOT EXISTS guard skips any line that already has the accessory
-- child, and the partial unique index (parentLineItemId, bulkAssetId where
-- childKind='ACCESSORY') is the backstop. Scoped to non-template, non-finished
-- projects so finalized quotes/invoices are left untouched. Quantity is scaled by
-- the line quantity (a "2x IMX6A" line gets 2x of each model accessory).
--
-- CRITICAL scoping: only lines that have NOT started fulfillment
-- (status IN QUOTED/CONFIRMED, checkedOutQuantity = 0). Injecting an accessory
-- child onto an already-prepped/checked-out line would create a phantom,
-- un-picked, un-deployed accessory on gear that's already out the door —
-- corrupting pick lists / return sheets / progress counters. Those lines are
-- skipped; only quote/confirm-stage lines (where adding the accessory is what a
-- fresh add would do anyway) are backfilled.
--
-- Row ids: md5(random()+line+bulk) — any unique String PK is valid (the column is
-- TEXT with no format constraint); we avoid gen_random_uuid/pgcrypto to not depend
-- on an extension.

INSERT INTO "project_line_item" (
  "id", "organizationId", "projectId", "type", "modelId", "bulkAssetId",
  "quantity", "isKitChild", "childKind", "parentLineItemId", "categoryId",
  "groupId", "pricingType", "duration", "sortOrder", "updatedAt"
)
SELECT
  'bf' || md5(random()::text || pli."id" || mba."bulkAssetId"),
  pli."organizationId",
  pli."projectId",
  'EQUIPMENT',
  ba."modelId",
  mba."bulkAssetId",
  pli."quantity" * mba."quantity",
  true,
  'ACCESSORY',
  pli."id",
  pli."categoryId",
  pli."groupId",
  pli."pricingType",
  pli."duration",
  mba."sortOrder",
  now()
FROM "project_line_item" pli
JOIN "project" p ON p."id" = pli."projectId"
JOIN "model_bulk_accessory" mba
  ON mba."modelId" = pli."modelId" AND mba."organizationId" = pli."organizationId"
JOIN "bulk_asset" ba ON ba."id" = mba."bulkAssetId"
WHERE pli."type" = 'EQUIPMENT'
  AND pli."modelId" IS NOT NULL
  AND pli."assetId" IS NULL
  AND pli."kitId" IS NULL
  AND pli."isKitChild" = false
  AND pli."isContainerLineItem" = false
  AND pli."childKind" IS NULL
  AND pli."subHireId" IS NULL
  AND pli."status" IN ('QUOTED', 'CONFIRMED')
  AND pli."checkedOutQuantity" = 0
  AND p."isTemplate" = false
  AND p."status" NOT IN ('CANCELLED', 'COMPLETED', 'INVOICED', 'RETURNED')
  AND NOT EXISTS (
    SELECT 1 FROM "project_line_item" c
    WHERE c."parentLineItemId" = pli."id"
      AND c."childKind" = 'ACCESSORY'
      AND c."bulkAssetId" = mba."bulkAssetId"
  );

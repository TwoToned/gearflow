-- Per-parent-unit accessory tracking (FEATUREDOCS/48).
-- An ACCESSORY-line unit (e.g. a battery kit) is packed under one specific
-- parent unit (the handheld it travels with). This denormalised link stores
-- that parent unit's asset id so prep/return and the per-unit docket render can
-- scope an accessory to a single parent unit. Null on all non-accessory units.
ALTER TABLE "project_line_item_unit" ADD COLUMN "parentUnitAssetId" TEXT;

-- Lookup: "the accessory units packed under parent unit X on this line".
CREATE INDEX "project_line_item_unit_lineItemId_parentUnitAssetId_idx"
  ON "project_line_item_unit" ("lineItemId", "parentUnitAssetId");

-- Remove the pricing-optimizer billing-period config columns.
-- The min-cost optimizer + per-group billing-period config have been removed in
-- favour of simple auto-pricing (rate × default rental period × qty). The model
-- rate fields, manual price override, priceBreakdown/priceOverridden/overrideReason
-- columns, and the dormant OPTIMIZED pricingType enum value are intentionally kept.

ALTER TABLE "project" DROP COLUMN IF EXISTS "billingMonths", DROP COLUMN IF EXISTS "billingWeeks", DROP COLUMN IF EXISTS "billingDays";
ALTER TABLE "project_group" DROP COLUMN IF EXISTS "billingMonths", DROP COLUMN IF EXISTS "billingWeeks", DROP COLUMN IF EXISTS "billingDays";

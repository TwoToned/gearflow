-- Phase 3 decommission tail: DROP the remaining Convex-native config/gap/webhook tables.
--
-- Follow-up to 20260717000000 (which dropped the 65 core domain tables). These 11 were
-- kept that round only out of one-way-door caution; each is now individually verified as
-- Convex sole-source-of-truth with ZERO runtime `prisma.<model>` access:
--   site_settings, notification_email_log, woocommerce_integration, document_template,
--   section_preset, warehouse_dashboard_token, test_tag_auditor_token  -> read/written via
--     api.* Convex mutations/queries (each server owner carries a "Phase C config-leftover
--     inversion" comment); the public token validators hash -> Convex getByHash.
--   category_slot   -> the app reads slots from the Convex `categorySlots` table
--     (equipment-tab-reconstruct.ts) + projectGroup.categoryId/sortOrder; PG rows are dead
--     legacy from before the #558 project-group/slot unification.
--   line_item_merge_map -> the Convex `lineItemMergeMaps` table is write-only audit
--     (projectLineItems.ts insert); NO `api.lineItemMergeMaps.*` reads in the app. The PG
--     rows are historic 2026-05-30 split audit that nothing consumes.
--   webhook, webhook_delivery -> 0 rows in PG; the webhook feature runs entirely on Convex
--     (api.webhooks.* list/deliveries/create/markSucceeded).
--
-- KEPT ON POSTGRES (end-state): Better Auth (user/session/account/verification/organization/
-- member/invitation/twoFactor/backup_code/passkey/jwks/sso_provider/pending_sso_approval),
-- the dormant custom-API pair (api_key/api_idempotency, reinstate-later), and the frozen
-- activity_log audit history (5092 rows). Fresh pg_dump taken immediately before this.
-- CASCADE drops any dependent FK constraints; no ANALYZE needed (no rows change in survivors).

DROP TABLE IF EXISTS "site_settings" CASCADE;
DROP TABLE IF EXISTS "notification_email_log" CASCADE;
DROP TABLE IF EXISTS "woocommerce_integration" CASCADE;
DROP TABLE IF EXISTS "document_template" CASCADE;
DROP TABLE IF EXISTS "section_preset" CASCADE;
DROP TABLE IF EXISTS "warehouse_dashboard_token" CASCADE;
DROP TABLE IF EXISTS "test_tag_auditor_token" CASCADE;
DROP TABLE IF EXISTS "category_slot" CASCADE;
DROP TABLE IF EXISTS "line_item_merge_map" CASCADE;
DROP TABLE IF EXISTS "webhook_delivery" CASCADE;
DROP TABLE IF EXISTS "webhook" CASCADE;

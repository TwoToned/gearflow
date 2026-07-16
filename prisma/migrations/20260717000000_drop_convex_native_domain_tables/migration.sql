-- Phase 3 decommission (Stage 3+4): DROP the Convex-native domain tables.
--
-- Every domain/business table below has been migrated to Convex as the sole source
-- of truth (browser-direct reads AND writes, all `NATIVE_*` flags on in prod). A
-- pre-cutover parity check confirmed Convex holds >= the Postgres rows for every
-- table; the only Postgres-ahead rows were deleted-in-Convex ghosts (frozen PG never
-- got the delete). Full pg_dump + Convex snapshot taken immediately before this
-- migration (see docs/convex-backup-restore-runbook.md).
--
-- KEPT ON POSTGRES (NOT dropped): Better Auth (user/session/account/verification/
-- organization/member/invitation/twoFactor/backup_code/passkey/jwks/sso_provider/
-- pending_sso_approval), dormant API (api_key/api_idempotency), webhooks
-- (webhook/webhook_delivery), audit (activity_log), and the config/ambiguous set
-- (site_settings/notification_email_log/woocommerce_integration/document_template/
-- section_preset/warehouse_dashboard_token/test_tag_auditor_token). Two domain
-- tables with unresolved parity gaps are deliberately retained for a follow-up:
-- category_slot (Convex represents slots differently post-unification) and
-- line_item_merge_map (5 historic split rows not yet backfilled to the Convex table).
--
-- CASCADE drops the dependent FK constraints these tables' ids are referenced by
-- (e.g. category_slot.projectGroupId); those columns become plain external cuids,
-- matching every prior decommission FK drop. No ANALYZE needed — no rows change in
-- the surviving tables (DROP TABLE removes the table wholesale).

DROP TABLE IF EXISTS "_CrewMemberToCrewSkill" CASCADE;
DROP TABLE IF EXISTS "asset" CASCADE;
DROP TABLE IF EXISTS "asset_bulk_child" CASCADE;
DROP TABLE IF EXISTS "asset_media" CASCADE;
DROP TABLE IF EXISTS "asset_scan_log" CASCADE;
DROP TABLE IF EXISTS "brand_template" CASCADE;
DROP TABLE IF EXISTS "bulk_asset" CASCADE;
DROP TABLE IF EXISTS "category" CASCADE;
DROP TABLE IF EXISTS "check_item" CASCADE;
DROP TABLE IF EXISTS "check_record" CASCADE;
DROP TABLE IF EXISTS "client" CASCADE;
DROP TABLE IF EXISTS "client_media" CASCADE;
DROP TABLE IF EXISTS "crew_assignment" CASCADE;
DROP TABLE IF EXISTS "crew_availability" CASCADE;
DROP TABLE IF EXISTS "crew_member" CASCADE;
DROP TABLE IF EXISTS "crew_role" CASCADE;
DROP TABLE IF EXISTS "crew_shift" CASCADE;
DROP TABLE IF EXISTS "crew_skill" CASCADE;
DROP TABLE IF EXISTS "crew_time_entry" CASCADE;
DROP TABLE IF EXISTS "custom_field_definition" CASCADE;
DROP TABLE IF EXISTS "file_upload" CASCADE;
DROP TABLE IF EXISTS "group_template" CASCADE;
DROP TABLE IF EXISTS "group_template_item" CASCADE;
DROP TABLE IF EXISTS "kit" CASCADE;
DROP TABLE IF EXISTS "kit_bulk_item" CASCADE;
DROP TABLE IF EXISTS "kit_check_item" CASCADE;
DROP TABLE IF EXISTS "kit_media" CASCADE;
DROP TABLE IF EXISTS "kit_revenue_allocation" CASCADE;
DROP TABLE IF EXISTS "kit_serialized_item" CASCADE;
DROP TABLE IF EXISTS "location" CASCADE;
DROP TABLE IF EXISTS "location_media" CASCADE;
DROP TABLE IF EXISTS "maintenance_record" CASCADE;
DROP TABLE IF EXISTS "maintenance_record_asset" CASCADE;
DROP TABLE IF EXISTS "model" CASCADE;
DROP TABLE IF EXISTS "model_bulk_accessory" CASCADE;
DROP TABLE IF EXISTS "model_check_item" CASCADE;
DROP TABLE IF EXISTS "model_media" CASCADE;
DROP TABLE IF EXISTS "notification_dismissal" CASCADE;
DROP TABLE IF EXISTS "project" CASCADE;
DROP TABLE IF EXISTS "project_category" CASCADE;
DROP TABLE IF EXISTS "project_group" CASCADE;
DROP TABLE IF EXISTS "project_line_item" CASCADE;
DROP TABLE IF EXISTS "project_line_item_unit" CASCADE;
DROP TABLE IF EXISTS "project_manager" CASCADE;
DROP TABLE IF EXISTS "project_media" CASCADE;
DROP TABLE IF EXISTS "project_model_revenue" CASCADE;
DROP TABLE IF EXISTS "project_number_sequence" CASCADE;
DROP TABLE IF EXISTS "project_service" CASCADE;
DROP TABLE IF EXISTS "project_task" CASCADE;
DROP TABLE IF EXISTS "saved_table_view" CASCADE;
DROP TABLE IF EXISTS "service_template" CASCADE;
DROP TABLE IF EXISTS "sub_hire" CASCADE;
DROP TABLE IF EXISTS "sub_hire_group" CASCADE;
DROP TABLE IF EXISTS "sub_hire_item" CASCADE;
DROP TABLE IF EXISTS "sub_hire_media" CASCADE;
DROP TABLE IF EXISTS "sub_test_record" CASCADE;
DROP TABLE IF EXISTS "supplier" CASCADE;
DROP TABLE IF EXISTS "supplier_model_rate" CASCADE;
DROP TABLE IF EXISTS "supplier_order" CASCADE;
DROP TABLE IF EXISTS "supplier_order_item" CASCADE;
DROP TABLE IF EXISTS "test_profile" CASCADE;
DROP TABLE IF EXISTS "test_tag_asset" CASCADE;
DROP TABLE IF EXISTS "test_tag_record" CASCADE;
DROP TABLE IF EXISTS "user_notification_preference" CASCADE;
DROP TABLE IF EXISTS "warehouse_close" CASCADE;
DROP TABLE IF EXISTS "woocommerce_order_log" CASCADE;

-- Phase C, Stage 1: drop every FOREIGN KEY constraint whose BOTH endpoints are
-- domain tables (the tables being decommissioned to Convex-only).
--
-- WHY: the 12 remaining mirror clusters (asset, kit, project, line-item,
-- line-item-unit, crew, crew-scheduling, file-upload, media, sub-hire,
-- warehouse-close, project-subtable) still dual-write Prisma-first because they
-- are FK anchors: other still-Prisma domain rows hold FK constraints pointing
-- into them. To invert each cluster's write to Convex-only (Stage 2) we must
-- stop writing the parent's Prisma row, which would violate any surviving child
-- FK. Dropping all domain<->domain FKs up front makes the inversions
-- order-independent. Referential integrity for these tables already lives in
-- application code + Convex (reads are 100% Convex since Phase A).
--
-- This deliberately PRESERVES domain->user and domain->organization FKs: those
-- constraints live on the domain (child) side and are removed automatically when
-- the domain tables are dropped in Stage 4. Keeping them now changes nothing.
--
-- Self-discovering by design: rather than hand-list ~40 constraint names (a typo
-- would be silently swallowed by IF EXISTS and leave a live FK to block a later
-- inversion), we drop every FK where conrelid AND confrelid are both in the
-- domain-table set. Idempotent and drift-safe — re-running drops nothing new,
-- and constraints already dropped by Phase B simply do not match.
--
-- Pure DDL on constraints (no row data touched) -> no ANALYZE required.

DO $$
DECLARE
  r record;
  domain_tables text[] := ARRAY[
    'asset','asset_bulk_child','asset_media','asset_scan_log','brand_template',
    'bulk_asset','category','category_slot','check_item','check_record','client',
    'client_media','crew_assignment','crew_availability','crew_member','crew_role',
    'crew_shift','crew_skill','crew_time_entry','custom_field_definition',
    'document_template','file_upload','group_template','group_template_item','kit',
    'kit_bulk_item','kit_check_item','kit_media','kit_serialized_item',
    'line_item_merge_map','location','location_media','maintenance_record',
    'maintenance_record_asset','model','model_bulk_accessory','model_check_item',
    'model_media','notification_dismissal','notification_email_log','project',
    'project_category','project_group','project_line_item','project_line_item_unit',
    'project_manager','project_media','project_number_sequence','project_service',
    'project_task','saved_table_view','section_preset','service_template','sub_hire',
    'sub_hire_group','sub_hire_item','sub_hire_media','sub_test_record','supplier',
    'supplier_model_rate','supplier_order','supplier_order_item','test_profile',
    'test_tag_asset','test_tag_auditor_token','test_tag_record',
    'user_notification_preference','warehouse_close','warehouse_dashboard_token',
    'woocommerce_integration','woocommerce_order_log'
  ];
BEGIN
  FOR r IN
    SELECT con.conname,
           con.conrelid::regclass::text AS child_table
    FROM pg_constraint con
    JOIN pg_class child  ON child.oid  = con.conrelid
    JOIN pg_namespace ns ON ns.oid     = child.relnamespace
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND child.relname = ANY(domain_tables)
      AND (con.confrelid::regclass::text) = ANY(domain_tables)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   r.child_table, r.conname);
  END LOOP;
END $$;

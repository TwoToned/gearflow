-- Remove the Damage Capture feature: drop the damage_event table + its enums.
-- CASCADE clears the FK references from maintenance_record / asset / bulk_asset /
-- project / project_line_item_unit / crew_member / user. The return/check-in flow,
-- the returnCondition enum, and DAMAGED->IN_MAINTENANCE asset holds are unaffected
-- (they live on project_line_item_unit, not damage_event).
DROP TABLE IF EXISTS "damage_event" CASCADE;
DROP TYPE IF EXISTS "DamageStatus";
DROP TYPE IF EXISTS "DamageSeverity";

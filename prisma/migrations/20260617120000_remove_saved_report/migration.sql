-- Remove the over-built "Reports tab" feature (SavedReport model + scheduled exports).
-- The `reports` permission resource and Test&Tag compliance reports are kept separately.

DROP TABLE IF EXISTS "saved_report" CASCADE;
DROP TYPE IF EXISTS "ScheduleFrequency";

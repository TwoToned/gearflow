-- Remove crew certifications entirely.
-- The `crew_certification` table was created in 20260314200000_add_crew_system
-- with the `CrewCertStatus` enum. Both are dropped here.

DROP TABLE IF EXISTS "crew_certification" CASCADE;

DROP TYPE IF EXISTS "CrewCertStatus";

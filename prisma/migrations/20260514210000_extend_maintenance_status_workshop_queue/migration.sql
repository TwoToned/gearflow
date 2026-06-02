-- Wave 3: workshop / repair queue.
--
-- Extends MaintenanceStatus with AWAITING_PARTS (between SCHEDULED and
-- IN_PROGRESS) and QA (between IN_PROGRESS and COMPLETED). These give the
-- workshop a proper kanban-style flow and let the state machine treat all
-- three "in-the-shop" statuses as holding the asset in IN_MAINTENANCE.
--
-- Postgres lets you ADD VALUE on an existing enum without touching rows.
-- BEFORE/AFTER positioning makes the enum render in the expected workflow
-- order in dashboards.

ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PARTS' BEFORE 'IN_PROGRESS';
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'QA' BEFORE 'COMPLETED';

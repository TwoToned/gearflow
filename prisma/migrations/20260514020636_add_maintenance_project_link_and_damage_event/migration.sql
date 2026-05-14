-- Wave 2 Track A: MaintenanceRecord.projectId FK + DamageEvent model.
--
-- The FK on maintenance_record allows ProjectOperationalSummary to roll
-- maintenance cost into a project's operational P&L. Nullable because
-- preventive maintenance has no causal project.
--
-- DamageEvent is the source-of-truth row for a damage incident captured
-- at warehouse check-in (or recorded later). ProjectLineItem.returnCondition
-- stays as a fast filter; this row carries photos, severity, repair cost,
-- and charge-back state.

CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MAJOR', 'TOTAL');
CREATE TYPE "DamageStatus"   AS ENUM ('OPEN', 'UNDER_REPAIR', 'RESOLVED', 'CHARGED_BACK');

ALTER TABLE "maintenance_record"
  ADD COLUMN "projectId" TEXT;

ALTER TABLE "maintenance_record"
  ADD CONSTRAINT "maintenance_record_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "maintenance_record_projectId_idx" ON "maintenance_record"("projectId");

CREATE TABLE "damage_event" (
  "id"                  TEXT NOT NULL,
  "organizationId"      TEXT NOT NULL,
  "projectId"           TEXT,
  "lineItemId"          TEXT,
  "assetId"             TEXT,
  "bulkAssetId"         TEXT,
  "severity"            "DamageSeverity" NOT NULL,
  "status"              "DamageStatus" NOT NULL DEFAULT 'OPEN',
  "notes"               TEXT,
  "photos"              TEXT[] DEFAULT ARRAY[]::TEXT[],
  "estimatedCost"       DECIMAL(10,2),
  "actualCost"          DECIMAL(10,2),
  "chargedBack"         BOOLEAN NOT NULL DEFAULT false,
  "maintenanceRecordId" TEXT,
  "createdById"         TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "damage_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "damage_event_organizationId_status_idx" ON "damage_event"("organizationId", "status");
CREATE INDEX "damage_event_projectId_idx"             ON "damage_event"("projectId");
CREATE INDEX "damage_event_assetId_idx"               ON "damage_event"("assetId");
CREATE INDEX "damage_event_bulkAssetId_idx"           ON "damage_event"("bulkAssetId");

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_lineItemId_fkey"
  FOREIGN KEY ("lineItemId") REFERENCES "project_line_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_bulkAssetId_fkey"
  FOREIGN KEY ("bulkAssetId") REFERENCES "bulk_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_maintenanceRecordId_fkey"
  FOREIGN KEY ("maintenanceRecordId") REFERENCES "maintenance_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "damage_event"
  ADD CONSTRAINT "damage_event_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

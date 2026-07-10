-- Revenue allocation for gear ROI. See docs/revenue-allocation-design.md.
--
-- Adds the two allocation columns to project_line_item, plus two Convex-only
-- tables. The tables are created here so `prisma migrate deploy` and the drift
-- check stay clean; no Prisma row is ever written to them (Phase C write
-- inversion — the Convex docs are the sole source of truth).

-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM (
  'DIRECT',
  'KIT_PERCENT',
  'WEIGHTED',
  'EQUAL_SPLIT',
  'EXCLUDED_SUBHIRE',
  'EXCLUDED_NON_GEAR',
  'NO_REVENUE'
);

-- AlterTable
-- Nullable, no default: an un-allocated line is meaningfully distinct from a $0
-- one, and backfilling every historical row here would rewrite the whole table.
-- scripts/convex-backfill-revenue-allocation.ts fills them in Convex instead.
ALTER TABLE "project_line_item"
  ADD COLUMN "allocatedRevenue" DECIMAL(12,2),
  ADD COLUMN "allocationBasis" "AllocationBasis";

-- CreateTable
CREATE TABLE "kit_revenue_allocation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kitId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "allocationPercent" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "kit_revenue_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_model_revenue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "allocatedRevenue" DECIMAL(12,2) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_model_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kit_revenue_allocation_kitId_modelId_key" ON "kit_revenue_allocation"("kitId", "modelId");
CREATE INDEX "kit_revenue_allocation_organizationId_idx" ON "kit_revenue_allocation"("organizationId");
CREATE INDEX "kit_revenue_allocation_kitId_idx" ON "kit_revenue_allocation"("kitId");
CREATE INDEX "kit_revenue_allocation_modelId_idx" ON "kit_revenue_allocation"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "project_model_revenue_projectId_modelId_key" ON "project_model_revenue"("projectId", "modelId");
CREATE INDEX "project_model_revenue_organizationId_idx" ON "project_model_revenue"("organizationId");
CREATE INDEX "project_model_revenue_projectId_idx" ON "project_model_revenue"("projectId");
CREATE INDEX "project_model_revenue_modelId_idx" ON "project_model_revenue"("modelId");
CREATE INDEX "project_model_revenue_organizationId_modelId_idx" ON "project_model_revenue"("organizationId", "modelId");

-- AddForeignKey
ALTER TABLE "kit_revenue_allocation" ADD CONSTRAINT "kit_revenue_allocation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_model_revenue" ADD CONSTRAINT "project_model_revenue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both ALTERs are metadata-only (nullable ADD COLUMN, no rewrite) and the new
-- tables are empty, so no ANALYZE is needed here. The Convex backfill does not
-- touch Postgres.

-- Composite index for the fleet ROI date-window scan. Without it the report has to
-- take an index prefix and filter, which reads the wrong projects on a large org.
CREATE INDEX "project_organizationId_rentalStartDate_idx" ON "project"("organizationId", "rentalStartDate");

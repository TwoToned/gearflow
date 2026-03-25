-- DropIndex
DROP INDEX IF EXISTS "warehouse_close_organizationId_projectId_idx";

-- CreateIndex (unique replaces the old non-unique index)
CREATE UNIQUE INDEX "warehouse_close_projectId_organizationId_key" ON "warehouse_close"("projectId", "organizationId");

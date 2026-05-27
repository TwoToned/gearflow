-- CreateTable
CREATE TABLE "line_item_merge_map" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "oldLineItemId" TEXT NOT NULL,
    "canonicalLineItemId" TEXT NOT NULL,
    "movedUnitId" TEXT,
    "checkRecordsRepointed" INTEGER NOT NULL DEFAULT 0,
    "damageEventsRepointed" INTEGER NOT NULL DEFAULT 0,
    "serviceRepointed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_item_merge_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "line_item_merge_map_oldLineItemId_key" ON "line_item_merge_map"("oldLineItemId");

-- CreateIndex
CREATE INDEX "line_item_merge_map_organizationId_idx" ON "line_item_merge_map"("organizationId");

-- CreateIndex
CREATE INDEX "line_item_merge_map_canonicalLineItemId_idx" ON "line_item_merge_map"("canonicalLineItemId");

-- AddForeignKey
ALTER TABLE "line_item_merge_map" ADD CONSTRAINT "line_item_merge_map_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


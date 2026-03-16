-- CreateTable
CREATE TABLE "warehouse_dashboard_token" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "locationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "layout" TEXT NOT NULL DEFAULT 'standard',
    "createdById" TEXT NOT NULL,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_dashboard_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_dashboard_token_tokenHash_key" ON "warehouse_dashboard_token"("tokenHash");

-- CreateIndex
CREATE INDEX "warehouse_dashboard_token_organizationId_idx" ON "warehouse_dashboard_token"("organizationId");

-- AddForeignKey
ALTER TABLE "warehouse_dashboard_token" ADD CONSTRAINT "warehouse_dashboard_token_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_dashboard_token" ADD CONSTRAINT "warehouse_dashboard_token_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_dashboard_token" ADD CONSTRAINT "warehouse_dashboard_token_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

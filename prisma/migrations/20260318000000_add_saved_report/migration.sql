-- CreateTable
CREATE TABLE "saved_report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dataSource" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdById" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_report_organizationId_idx" ON "saved_report"("organizationId");

-- CreateIndex
CREATE INDEX "saved_report_organizationId_createdById_idx" ON "saved_report"("organizationId", "createdById");

-- AddForeignKey
ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

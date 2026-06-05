-- CreateTable
CREATE TABLE "project_number_sequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_number_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_number_sequence_organizationId_scopeKey_key" ON "project_number_sequence"("organizationId", "scopeKey");

-- AddForeignKey
ALTER TABLE "project_number_sequence" ADD CONSTRAINT "project_number_sequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "saved_table_view" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_table_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_table_view_userId_tableId_idx" ON "saved_table_view"("userId", "tableId");

-- CreateIndex
CREATE INDEX "saved_table_view_organizationId_idx" ON "saved_table_view"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_table_view_organizationId_userId_tableId_name_key" ON "saved_table_view"("organizationId", "userId", "tableId", "name");

-- AddForeignKey
ALTER TABLE "saved_table_view" ADD CONSTRAINT "saved_table_view_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_table_view" ADD CONSTRAINT "saved_table_view_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

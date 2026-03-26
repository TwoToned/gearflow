-- CreateTable
CREATE TABLE "test_tag_auditor_token" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdById" TEXT NOT NULL,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_tag_auditor_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_tag_auditor_token_tokenHash_key" ON "test_tag_auditor_token"("tokenHash");

-- CreateIndex
CREATE INDEX "test_tag_auditor_token_organizationId_idx" ON "test_tag_auditor_token"("organizationId");

-- AddForeignKey
ALTER TABLE "test_tag_auditor_token" ADD CONSTRAINT "test_tag_auditor_token_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_tag_auditor_token" ADD CONSTRAINT "test_tag_auditor_token_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

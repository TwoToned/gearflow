-- CreateEnum
CREATE TYPE "SSOApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable: sso_provider (managed by @better-auth/sso plugin)
CREATE TABLE "sso_provider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pending_sso_approval
CREATE TABLE "pending_sso_approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "idpGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedRole" TEXT,
    "providerId" TEXT NOT NULL,
    "status" "SSOApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_sso_approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_provider_providerId_key" ON "sso_provider"("providerId");
CREATE INDEX "sso_provider_organizationId_idx" ON "sso_provider"("organizationId");
CREATE INDEX "sso_provider_domain_idx" ON "sso_provider"("domain");

CREATE UNIQUE INDEX "pending_sso_approval_organizationId_userId_key" ON "pending_sso_approval"("organizationId", "userId");
CREATE INDEX "pending_sso_approval_organizationId_status_idx" ON "pending_sso_approval"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_sso_approval" ADD CONSTRAINT "pending_sso_approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_sso_approval" ADD CONSTRAINT "pending_sso_approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pending_sso_approval" ADD CONSTRAINT "pending_sso_approval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

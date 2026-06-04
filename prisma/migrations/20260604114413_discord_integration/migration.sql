-- CreateEnum
CREATE TYPE "DiscordOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "project" ADD COLUMN "discordChannelId" TEXT;

-- CreateTable
CREATE TABLE "discord_integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "signingSecret" TEXT NOT NULL,
    "guildId" TEXT,
    "projectCategoryId" TEXT,
    "alertChannelId" TEXT,
    "auditChannelId" TEXT,
    "linkTokenTtlMinutes" INTEGER NOT NULL DEFAULT 15,
    "enrollmentOpen" BOOLEAN NOT NULL DEFAULT true,
    "lastHeartbeatAt" TIMESTAMP(3),
    "botUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_outbox" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "DiscordOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_account_link" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedById" TEXT,

    CONSTRAINT "discord_account_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_link_token" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "guildId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_discordChannelId_key" ON "project"("discordChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_integration_organizationId_key" ON "discord_integration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_outbox_dedupeKey_key" ON "discord_outbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "discord_outbox_organizationId_id_idx" ON "discord_outbox"("organizationId", "id");

-- CreateIndex
CREATE INDEX "discord_outbox_status_nextAttemptAt_idx" ON "discord_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "discord_account_link_crewMemberId_key" ON "discord_account_link"("crewMemberId");

-- CreateIndex
CREATE INDEX "discord_account_link_organizationId_idx" ON "discord_account_link"("organizationId");

-- CreateIndex
CREATE INDEX "discord_account_link_discordUserId_idx" ON "discord_account_link"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_account_link_organizationId_discordUserId_key" ON "discord_account_link"("organizationId", "discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "discord_link_token_tokenHash_key" ON "discord_link_token"("tokenHash");

-- CreateIndex
CREATE INDEX "discord_link_token_organizationId_idx" ON "discord_link_token"("organizationId");

-- CreateIndex
CREATE INDEX "discord_link_token_expiresAt_idx" ON "discord_link_token"("expiresAt");

-- AddForeignKey
ALTER TABLE "discord_integration" ADD CONSTRAINT "discord_integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_outbox" ADD CONSTRAINT "discord_outbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_account_link" ADD CONSTRAINT "discord_account_link_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_account_link" ADD CONSTRAINT "discord_account_link_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_link_token" ADD CONSTRAINT "discord_link_token_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discord_link_token" ADD CONSTRAINT "discord_link_token_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

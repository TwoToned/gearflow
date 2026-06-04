-- AlterTable: Discord credentials + behavior config moved into the row
-- so the admin page is the single source of truth (no .env on the bot host).

ALTER TABLE "discord_integration"
  ADD COLUMN "discordBotToken"      TEXT,
  ADD COLUMN "discordApplicationId" TEXT,
  ADD COLUMN "archiveCategoryId"    TEXT,
  ADD COLUMN "channelCreateOnStatuses"  "ProjectStatus"[] NOT NULL DEFAULT ARRAY['CONFIRMED']::"ProjectStatus"[],
  ADD COLUMN "channelArchiveOnStatuses" "ProjectStatus"[] NOT NULL DEFAULT ARRAY['COMPLETED', 'INVOICED', 'RETURNED', 'CANCELLED']::"ProjectStatus"[],
  ADD COLUMN "postWelcomeOnCreate"        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "postFaultsToProjectChannel" BOOLEAN NOT NULL DEFAULT true;

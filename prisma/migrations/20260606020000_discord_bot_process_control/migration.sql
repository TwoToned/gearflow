-- Cross-process Discord bot control plane.
-- The bot moves to its own pm2 process (gearflow-discord-bot); the admin page
-- communicates intent through the DB instead of in-process function calls.

-- CreateEnum
CREATE TYPE "DiscordBotDesiredState" AS ENUM ('RUNNING', 'STOPPED');

-- AlterTable
ALTER TABLE "discord_integration"
  ADD COLUMN "botDesiredState" "DiscordBotDesiredState" NOT NULL DEFAULT 'RUNNING',
  ADD COLUMN "botRestartRequestedAt" TIMESTAMP(3),
  ADD COLUMN "botStartError" TEXT,
  ADD COLUMN "botPid" INTEGER;

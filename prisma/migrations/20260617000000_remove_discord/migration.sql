-- Remove the Discord integration end to end.
--
-- Email + in-app notifications are a separate path (NotificationEmailLog +
-- Resend) and are untouched. The transactional outbox was Discord-only.

-- Drop the four Discord tables. CASCADE removes their FKs, unique constraints,
-- and indexes (including the per-org / crew-member / dedupe / token-hash indexes).
DROP TABLE IF EXISTS "discord_link_token" CASCADE;
DROP TABLE IF EXISTS "discord_account_link" CASCADE;
DROP TABLE IF EXISTS "discord_outbox" CASCADE;
DROP TABLE IF EXISTS "discord_integration" CASCADE;

-- Drop the Discord-only enums (now unreferenced after the tables are gone).
DROP TYPE IF EXISTS "DiscordOutboxStatus";
DROP TYPE IF EXISTS "DiscordBotDesiredState";

-- Drop the Discord columns on retained tables. Dropping the column also drops
-- its unique index (project_discordChannelId_key / damage_event_discordIdempotencyKey_key).
ALTER TABLE "project" DROP COLUMN IF EXISTS "discordChannelId";
-- damage_event may already be gone (removed by chore/remove-damage-capture); guard the table existence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'damage_event') THEN
    ALTER TABLE "damage_event" DROP COLUMN IF EXISTS "discordIdempotencyKey";
  END IF;
END $$;

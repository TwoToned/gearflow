-- AlterTable
ALTER TABLE "damage_event" ADD COLUMN     "reportedByCrewMemberId" TEXT,
ADD COLUMN     "discordIdempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "damage_event_discordIdempotencyKey_key" ON "damage_event"("discordIdempotencyKey");

-- CreateIndex
CREATE INDEX "damage_event_reportedByCrewMemberId_idx" ON "damage_event"("reportedByCrewMemberId");

-- AddForeignKey
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_reportedByCrewMemberId_fkey" FOREIGN KEY ("reportedByCrewMemberId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

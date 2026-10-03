-- B4 (#1096): abandonment guards — tracks which stage of the "never
-- activated" email ladder has been sent, so the daily sweep never re-sends a
-- stage (the eligibility predicate itself stays fully derived/unstored).
ALTER TABLE "organization" ADD COLUMN "dormancyStage" INTEGER;
ALTER TABLE "organization" ADD COLUMN "dormancyNoticedAt" TIMESTAMP(3);
ALTER TABLE "organization" ADD COLUMN "dormancyReactivationToken" TEXT;
CREATE UNIQUE INDEX "organization_dormancyReactivationToken_key" ON "organization"("dormancyReactivationToken");

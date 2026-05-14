-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "saved_report"
  ADD COLUMN "scheduleFrequency"  "ScheduleFrequency",
  ADD COLUMN "scheduleHour"       INTEGER,
  ADD COLUMN "scheduleDayOfWeek"  INTEGER,
  ADD COLUMN "scheduleDayOfMonth" INTEGER,
  ADD COLUMN "scheduleRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scheduleLastRunAt"  TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "saved_report_scheduleFrequency_scheduleLastRunAt_idx"
  ON "saved_report" ("scheduleFrequency", "scheduleLastRunAt");

-- AlterTable
ALTER TABLE "project" ADD COLUMN "billingWeeks" INTEGER,
ADD COLUMN "billingDays" INTEGER;

-- AlterTable
ALTER TABLE "project_group" ADD COLUMN "billingWeeks" INTEGER,
ADD COLUMN "billingDays" INTEGER;

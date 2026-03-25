-- AlterEnum
ALTER TYPE "ApplianceType" ADD VALUE 'MICROWAVE';

-- CreateTable
CREATE TABLE "test_profile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "equipmentClass" "EquipmentClass" NOT NULL DEFAULT 'CLASS_I',
    "applianceType" "ApplianceType" NOT NULL DEFAULT 'APPLIANCE',
    "visualChecks" JSONB NOT NULL,
    "electricalTests" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "requiresSubTests" BOOLEAN NOT NULL DEFAULT false,
    "defaultSubTestCount" INTEGER NOT NULL DEFAULT 1,
    "subTestLabel" TEXT NOT NULL DEFAULT 'Outlet',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_test_record" (
    "id" TEXT NOT NULL,
    "testTagRecordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "result" "TestResult" NOT NULL DEFAULT 'PASS',
    "earthContinuityResult" "TestResult" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "earthContinuityReading" DOUBLE PRECISION,
    "insulationResult" "TestResult" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "insulationReading" DOUBLE PRECISION,
    "leakageCurrentResult" "TestResult" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "leakageCurrentReading" DOUBLE PRECISION,
    "polarityResult" "TestResult" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_test_record_pkey" PRIMARY KEY ("id")
);

-- AddColumns to test_tag_asset
ALTER TABLE "test_tag_asset" ADD COLUMN "testProfileId" TEXT;
ALTER TABLE "test_tag_asset" ADD COLUMN "outletCount" INTEGER;

-- AddColumns to test_tag_record
ALTER TABLE "test_tag_record" ADD COLUMN "testProfileId" TEXT;

-- AddColumns to model
ALTER TABLE "model" ADD COLUMN "defaultTestProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "test_profile_organizationId_name_key" ON "test_profile"("organizationId", "name");
CREATE INDEX "test_profile_organizationId_isActive_idx" ON "test_profile"("organizationId", "isActive");
CREATE INDEX "test_profile_organizationId_equipmentClass_applianceType_idx" ON "test_profile"("organizationId", "equipmentClass", "applianceType");
CREATE INDEX "sub_test_record_testTagRecordId_sortOrder_idx" ON "sub_test_record"("testTagRecordId", "sortOrder");
CREATE INDEX "test_tag_asset_testProfileId_idx" ON "test_tag_asset"("testProfileId");
CREATE INDEX "test_tag_record_testProfileId_idx" ON "test_tag_record"("testProfileId");

-- AddForeignKey
ALTER TABLE "test_profile" ADD CONSTRAINT "test_profile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_tag_asset" ADD CONSTRAINT "test_tag_asset_testProfileId_fkey" FOREIGN KEY ("testProfileId") REFERENCES "test_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "test_tag_record" ADD CONSTRAINT "test_tag_record_testProfileId_fkey" FOREIGN KEY ("testProfileId") REFERENCES "test_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_test_record" ADD CONSTRAINT "sub_test_record_testTagRecordId_fkey" FOREIGN KEY ("testTagRecordId") REFERENCES "test_tag_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "model" ADD CONSTRAINT "model_defaultTestProfileId_fkey" FOREIGN KEY ("defaultTestProfileId") REFERENCES "test_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('DELIVERY', 'PICKUP', 'BUMP_IN', 'BUMP_OUT', 'LABOUR', 'MISC');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "project_service" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "date" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "scheduledTime" TEXT,
    "estimatedDuration" INTEGER,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "ServiceStatus" NOT NULL DEFAULT 'PLANNED',
    "showOnDocuments" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(10,2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pricingType" "PricingType",
    "duration" DECIMAL(6,2),
    "discount" DECIMAL(5,2),
    "lineTotal" DECIMAL(10,2),
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "lineItemId" TEXT,
    "vehicleDescription" TEXT,
    "numberOfTrips" INTEGER,
    "crewCountRequired" INTEGER,
    "crewRoleId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultCrewCount" INTEGER,
    "defaultVehicle" TEXT,
    "defaultPricingType" "PricingType",
    "defaultUnitPrice" DECIMAL(10,2),
    "showOnDocuments" BOOLEAN NOT NULL DEFAULT false,
    "isAutoAdded" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_service_organizationId_idx" ON "project_service"("organizationId");
CREATE INDEX "project_service_projectId_idx" ON "project_service"("projectId");
CREATE INDEX "project_service_projectId_type_idx" ON "project_service"("projectId", "type");
CREATE INDEX "project_service_projectId_date_idx" ON "project_service"("projectId", "date");
CREATE UNIQUE INDEX "project_service_lineItemId_key" ON "project_service"("lineItemId");

CREATE INDEX "service_template_organizationId_idx" ON "service_template"("organizationId");

-- AddForeignKey
ALTER TABLE "project_service" ADD CONSTRAINT "project_service_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_service" ADD CONSTRAINT "project_service_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_service" ADD CONSTRAINT "project_service_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "project_line_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_service" ADD CONSTRAINT "project_service_crewRoleId_fkey" FOREIGN KEY ("crewRoleId") REFERENCES "crew_role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add serviceId to crew_assignment for service-crew linking
ALTER TABLE "crew_assignment" ADD COLUMN "serviceId" TEXT;
CREATE INDEX "crew_assignment_serviceId_idx" ON "crew_assignment"("serviceId");
ALTER TABLE "crew_assignment" ADD CONSTRAINT "crew_assignment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "project_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_template" ADD CONSTRAINT "service_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

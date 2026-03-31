-- CreateEnum
CREATE TYPE "SubHireStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ON_HIRE', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sub_hire" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "createdById" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "SubHireStatus" NOT NULL DEFAULT 'DRAFT',
    "hireStart" TIMESTAMP(3),
    "hireEnd" TIMESTAMP(3),
    "totalCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "showOnDocs" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_hire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_hire_item" (
    "id" TEXT NOT NULL,
    "subHireId" TEXT NOT NULL,
    "modelId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unitCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pricingType" "PricingType" NOT NULL DEFAULT 'FLAT',
    "duration" INTEGER NOT NULL DEFAULT 1,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sub_hire_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_model_rate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "lastUnitCost" DECIMAL(10,2) NOT NULL,
    "pricingType" "PricingType" NOT NULL DEFAULT 'FLAT',
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_model_rate_pkey" PRIMARY KEY ("id")
);

-- Add SubHire FKs to ProjectLineItem
ALTER TABLE "project_line_item" ADD COLUMN "subHireId" TEXT;
ALTER TABLE "project_line_item" ADD COLUMN "subHireItemId" TEXT;

-- CreateIndex
CREATE INDEX "sub_hire_organizationId_idx" ON "sub_hire"("organizationId");
CREATE INDEX "sub_hire_organizationId_supplierId_idx" ON "sub_hire"("organizationId", "supplierId");
CREATE INDEX "sub_hire_organizationId_status_idx" ON "sub_hire"("organizationId", "status");
CREATE INDEX "sub_hire_organizationId_projectId_idx" ON "sub_hire"("organizationId", "projectId");
CREATE UNIQUE INDEX "sub_hire_organizationId_orderNumber_key" ON "sub_hire"("organizationId", "orderNumber");

CREATE INDEX "sub_hire_item_subHireId_idx" ON "sub_hire_item"("subHireId");
CREATE INDEX "sub_hire_item_modelId_idx" ON "sub_hire_item"("modelId");

CREATE INDEX "supplier_model_rate_organizationId_supplierId_idx" ON "supplier_model_rate"("organizationId", "supplierId");
CREATE INDEX "supplier_model_rate_organizationId_modelId_idx" ON "supplier_model_rate"("organizationId", "modelId");
CREATE UNIQUE INDEX "supplier_model_rate_organizationId_supplierId_modelId_key" ON "supplier_model_rate"("organizationId", "supplierId", "modelId");

CREATE INDEX "project_line_item_subHireId_idx" ON "project_line_item"("subHireId");
CREATE INDEX "project_line_item_subHireItemId_idx" ON "project_line_item"("subHireItemId");

-- AddForeignKey
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_hire" ADD CONSTRAINT "sub_hire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sub_hire_item" ADD CONSTRAINT "sub_hire_item_subHireId_fkey" FOREIGN KEY ("subHireId") REFERENCES "sub_hire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_hire_item" ADD CONSTRAINT "sub_hire_item_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_model_rate" ADD CONSTRAINT "supplier_model_rate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_model_rate" ADD CONSTRAINT "supplier_model_rate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_model_rate" ADD CONSTRAINT "supplier_model_rate_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_subHireId_fkey" FOREIGN KEY ("subHireId") REFERENCES "sub_hire"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_line_item" ADD CONSTRAINT "project_line_item_subHireItemId_fkey" FOREIGN KEY ("subHireItemId") REFERENCES "sub_hire_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

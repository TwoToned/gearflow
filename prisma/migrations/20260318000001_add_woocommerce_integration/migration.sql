-- CreateEnum
CREATE TYPE "WooOrderLogStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "woocommerce_integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookSecret" TEXT NOT NULL,
    "storeUrl" TEXT,
    "productMatchField" TEXT NOT NULL DEFAULT 'sku',
    "customFieldKey" TEXT,
    "rentalStartKey" TEXT,
    "rentalEndKey" TEXT,
    "eventStartKey" TEXT,
    "deliveryAddressKey" TEXT,
    "notesKey" TEXT,
    "dateFormat" TEXT NOT NULL DEFAULT 'auto',
    "defaultProjectType" TEXT NOT NULL DEFAULT 'DRY_HIRE',
    "autoConfirmEnquiry" BOOLEAN NOT NULL DEFAULT false,
    "notifyUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "woocommerce_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "woocommerce_order_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wooOrderId" INTEGER NOT NULL,
    "wooOrderNumber" TEXT,
    "status" "WooOrderLogStatus" NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "matchResults" JSONB,
    "dateExtraction" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "woocommerce_order_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_integration_organizationId_key" ON "woocommerce_integration"("organizationId");

-- CreateIndex
CREATE INDEX "woocommerce_order_log_organizationId_idx" ON "woocommerce_order_log"("organizationId");

-- CreateIndex
CREATE INDEX "woocommerce_order_log_wooOrderId_idx" ON "woocommerce_order_log"("wooOrderId");

-- AddForeignKey
ALTER TABLE "woocommerce_integration" ADD CONSTRAINT "woocommerce_integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_log" ADD CONSTRAINT "woocommerce_order_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "woocommerce_order_log" ADD CONSTRAINT "woocommerce_order_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

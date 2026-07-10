-- Webhooks: outbound events for agents/integrations.
-- See docs/designs/webhooks.md.

CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "webhook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '[]',
    "secret" TEXT NOT NULL,
    "previousSecret" TEXT,
    "previousSecretExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_delivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_organizationId_idx" ON "webhook"("organizationId");
CREATE INDEX "webhook_delivery_webhookId_idx" ON "webhook_delivery"("webhookId");
CREATE INDEX "webhook_delivery_organizationId_idx" ON "webhook_delivery"("organizationId");
-- The worker's claim query: pending rows whose backoff has elapsed.
CREATE INDEX "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery"("status", "nextAttemptAt");

ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

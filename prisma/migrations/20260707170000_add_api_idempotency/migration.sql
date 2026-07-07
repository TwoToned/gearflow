-- CreateTable
CREATE TABLE "api_idempotency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_apiKeyId_key_key" ON "api_idempotency"("apiKeyId", "key");

-- CreateIndex
CREATE INDEX "api_idempotency_organizationId_idx" ON "api_idempotency"("organizationId");

-- AddForeignKey
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_key"("id") ON DELETE CASCADE ON UPDATE CASCADE;

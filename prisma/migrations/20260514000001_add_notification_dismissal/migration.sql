-- CreateTable
CREATE TABLE "notification_dismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_dismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_dismissal_userId_notificationKey_key" ON "notification_dismissal"("userId", "notificationKey");

-- CreateIndex
CREATE INDEX "notification_dismissal_organizationId_userId_idx" ON "notification_dismissal"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "notification_dismissal" ADD CONSTRAINT "notification_dismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_dismissal" ADD CONSTRAINT "notification_dismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "user_notification_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "overdueMaintenance" BOOLEAN NOT NULL DEFAULT true,
    "overdueReturn" BOOLEAN NOT NULL DEFAULT true,
    "upcomingProject" BOOLEAN NOT NULL DEFAULT false,
    "lowStock" BOOLEAN NOT NULL DEFAULT true,
    "pendingInvitation" BOOLEAN NOT NULL DEFAULT true,
    "expiringCert" BOOLEAN NOT NULL DEFAULT true,
    "pendingOffers" BOOLEAN NOT NULL DEFAULT false,
    "pendingTimesheets" BOOLEAN NOT NULL DEFAULT false,
    "flaggedAsset" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preference_userId_key" ON "user_notification_preference"("userId");

-- AddForeignKey
ALTER TABLE "user_notification_preference" ADD CONSTRAINT "user_notification_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "notification_email_log" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_email_log_userId_notificationKey_key" ON "notification_email_log"("userId", "notificationKey");

-- CreateIndex
CREATE INDEX "notification_email_log_organizationId_sentAt_idx" ON "notification_email_log"("organizationId", "sentAt");

-- AddForeignKey
ALTER TABLE "notification_email_log" ADD CONSTRAINT "notification_email_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_email_log" ADD CONSTRAINT "notification_email_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmailBroadcast" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SENDING',
    "note" TEXT,
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "blocks" JSONB NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3D9A4F',
    "footer" TEXT NOT NULL DEFAULT '',
    "dailyLimit" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmailBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "emailBroadcastId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "resendId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailBroadcast_companyId_createdAt_idx" ON "EmailBroadcast"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailBroadcast_companyId_status_idx" ON "EmailBroadcast"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRecipient_resendId_key" ON "EmailRecipient"("resendId");

-- CreateIndex
CREATE INDEX "EmailRecipient_emailBroadcastId_status_idx" ON "EmailRecipient"("emailBroadcastId", "status");

-- CreateIndex
CREATE INDEX "EmailRecipient_companyId_sentAt_idx" ON "EmailRecipient"("companyId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRecipient_emailBroadcastId_email_key" ON "EmailRecipient"("emailBroadcastId", "email");

-- AddForeignKey
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_emailBroadcastId_fkey" FOREIGN KEY ("emailBroadcastId") REFERENCES "EmailBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('SENDING', 'PAUSED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SENDING',
    "note" TEXT,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateText" TEXT NOT NULL,
    "fromPhoneNumberId" TEXT,
    "stageId" TEXT NOT NULL,
    "tagId" TEXT,
    "dailyLimit" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "broadcastId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT[],
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "leadId" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_companyId_createdAt_idx" ON "Broadcast"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Broadcast_companyId_status_idx" ON "Broadcast"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_messageId_key" ON "BroadcastRecipient"("messageId");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_companyId_sentAt_idx" ON "BroadcastRecipient"("companyId", "sentAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_leadId_idx" ON "BroadcastRecipient"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_phone_key" ON "BroadcastRecipient"("broadcastId", "phone");

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

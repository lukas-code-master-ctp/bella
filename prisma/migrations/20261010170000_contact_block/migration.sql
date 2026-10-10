-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "blockedAt" TIMESTAMP(3),
ADD COLUMN "blockedReason" TEXT;

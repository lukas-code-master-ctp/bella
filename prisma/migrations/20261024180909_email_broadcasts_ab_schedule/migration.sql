-- AlterTable
ALTER TABLE "EmailBroadcast" ADD COLUMN     "resentFromId" TEXT,
ADD COLUMN     "subjectB" TEXT;

-- AlterTable
ALTER TABLE "EmailRecipient" ADD COLUMN     "variant" INTEGER NOT NULL DEFAULT 0;

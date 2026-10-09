-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "insightsAt" TIMESTAMP(3),
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "scoreReason" TEXT;

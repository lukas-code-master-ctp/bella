-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "abGroup" TEXT,
ADD COLUMN     "buttonIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "headerFileName" TEXT,
ADD COLUMN     "headerMimeType" TEXT,
ADD COLUMN     "headerUrl" TEXT,
ADD COLUMN     "resentFromId" TEXT,
ADD COLUMN     "templateCategory" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "BroadcastRecipient" ADD COLUMN     "buttonParams" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Broadcast_abGroup_idx" ON "Broadcast"("abGroup");

-- AlterEnum
ALTER TYPE "BroadcastStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "optedOutAt" TIMESTAMP(3);

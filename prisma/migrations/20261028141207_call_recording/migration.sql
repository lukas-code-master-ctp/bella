-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisStatus" TEXT,
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "proposedTasks" JSONB,
ADD COLUMN     "recordingUrl" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "transcript" TEXT;

-- AlterEnum
ALTER TYPE "AiLessonStatus" ADD VALUE 'INTEGRATED';

-- AlterTable
ALTER TABLE "AiLesson" ADD COLUMN     "integratedAt" TIMESTAMP(3);

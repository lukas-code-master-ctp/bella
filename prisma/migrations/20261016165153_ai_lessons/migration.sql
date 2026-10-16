-- CreateEnum
CREATE TYPE "AiLessonStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED');

-- CreateTable
CREATE TABLE "AiLesson" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "status" "AiLessonStatus" NOT NULL DEFAULT 'PENDING',
    "rule" TEXT NOT NULL,
    "badExample" TEXT NOT NULL DEFAULT '',
    "goodExample" TEXT NOT NULL DEFAULT '',
    "feedback" TEXT NOT NULL DEFAULT '',
    "conflict" TEXT NOT NULL DEFAULT '',
    "conversation" TEXT NOT NULL DEFAULT '',
    "testReply" TEXT,
    "testedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "messageId" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiLesson_companyId_status_idx" ON "AiLesson"("companyId", "status");

-- CreateTable
CREATE TABLE "WeeklyInsight" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "report" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "seenBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyInsight_periodEnd_key" ON "WeeklyInsight"("periodEnd");

-- CreateIndex
CREATE INDEX "WeeklyInsight_createdAt_idx" ON "WeeklyInsight"("createdAt");


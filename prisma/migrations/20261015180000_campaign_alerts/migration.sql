-- CreateTable
CREATE TABLE "CampaignAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "campaign" TEXT NOT NULL,
    "campaignId" TEXT,
    "leads" INTEGER NOT NULL,
    "lost" INTEGER NOT NULL,
    "won" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "advice" JSONB,
    "adviceModel" TEXT,
    "adviceAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedById" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAlert_companyId_campaign_key" ON "CampaignAlert"("companyId", "campaign");

-- CreateIndex
CREATE INDEX "CampaignAlert_companyId_resolvedAt_idx" ON "CampaignAlert"("companyId", "resolvedAt");

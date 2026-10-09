-- CreateTable
CREATE TABLE "LeadSource" (
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "adId" TEXT,
    "adType" TEXT,
    "adHeadline" TEXT,
    "adBody" TEXT,
    "adUrl" TEXT,
    "ctwaClid" TEXT,
    "adName" TEXT,
    "adsetName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "landingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("leadId")
);

-- CreateTable
CREATE TABLE "SourceLink" (
    "code" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "landingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,

    CONSTRAINT "SourceLink_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "SourceLink_createdAt_idx" ON "SourceLink"("createdAt");

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

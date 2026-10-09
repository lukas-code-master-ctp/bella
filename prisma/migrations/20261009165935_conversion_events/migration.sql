-- CreateTable
CREATE TABLE "ConversionEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversionEvent_status_createdAt_idx" ON "ConversionEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionEvent_leadId_kind_key" ON "ConversionEvent"("leadId", "kind");

-- AddForeignKey
ALTER TABLE "ConversionEvent" ADD CONSTRAINT "ConversionEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

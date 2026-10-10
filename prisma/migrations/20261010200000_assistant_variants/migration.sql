-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "variantId" TEXT;

-- CreateTable
CREATE TABLE "AssistantVariant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "assistantName" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_variantId_idx" ON "Lead"("variantId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "AssistantVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

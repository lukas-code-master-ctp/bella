-- Bella multi-empresa: cada dato lleva su companyId. Es aditiva: todo lo existente queda en la
-- empresa "default" (el valor por defecto de la columna), así el código anterior sigue funcionando.

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "AgentTranscript" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "AssignmentRule" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "AssistantVariant" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "CommentRule" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "ConversionEvent" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "DataDeletionRequest" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Funnel" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "KnowledgeDoc" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "LeadEvent" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "LeadSource" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "MediaFile" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "SocialComment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "SourceLink" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "WeeklyInsight" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "WhatsAppNumber" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default';

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_companyId_idx" ON "AgentRun"("companyId");

-- CreateIndex
CREATE INDEX "AgentTranscript_companyId_idx" ON "AgentTranscript"("companyId");

-- CreateIndex
CREATE INDEX "AiUsage_companyId_idx" ON "AiUsage"("companyId");

-- CreateIndex
CREATE INDEX "AssignmentRule_companyId_idx" ON "AssignmentRule"("companyId");

-- CreateIndex
CREATE INDEX "AssistantVariant_companyId_idx" ON "AssistantVariant"("companyId");

-- CreateIndex
CREATE INDEX "CommentRule_companyId_idx" ON "CommentRule"("companyId");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "ConversionEvent_companyId_idx" ON "ConversionEvent"("companyId");

-- CreateIndex
CREATE INDEX "CustomField_companyId_idx" ON "CustomField"("companyId");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_companyId_idx" ON "DataDeletionRequest"("companyId");

-- CreateIndex
CREATE INDEX "Funnel_companyId_idx" ON "Funnel"("companyId");

-- CreateIndex
CREATE INDEX "InventoryItem_companyId_idx" ON "InventoryItem"("companyId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_companyId_idx" ON "KnowledgeDoc"("companyId");

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");

-- CreateIndex
CREATE INDEX "LeadEvent_companyId_idx" ON "LeadEvent"("companyId");

-- CreateIndex
CREATE INDEX "LeadSource_companyId_idx" ON "LeadSource"("companyId");

-- CreateIndex
CREATE INDEX "MediaFile_companyId_idx" ON "MediaFile"("companyId");

-- CreateIndex
CREATE INDEX "Message_companyId_idx" ON "Message"("companyId");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "PushSubscription_companyId_idx" ON "PushSubscription"("companyId");

-- CreateIndex
CREATE INDEX "Setting_companyId_idx" ON "Setting"("companyId");

-- CreateIndex
CREATE INDEX "SocialComment_companyId_idx" ON "SocialComment"("companyId");

-- CreateIndex
CREATE INDEX "SourceLink_companyId_idx" ON "SourceLink"("companyId");

-- CreateIndex
CREATE INDEX "Stage_companyId_idx" ON "Stage"("companyId");

-- CreateIndex
CREATE INDEX "Tag_companyId_idx" ON "Tag"("companyId");

-- CreateIndex
CREATE INDEX "Task_companyId_idx" ON "Task"("companyId");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Webhook_companyId_idx" ON "Webhook"("companyId");

-- CreateIndex
CREATE INDEX "WeeklyInsight_companyId_idx" ON "WeeklyInsight"("companyId");

-- CreateIndex
CREATE INDEX "WhatsAppNumber_companyId_idx" ON "WhatsAppNumber"("companyId");

-- La empresa de los datos existentes, con el nombre que ya tenía en la configuración de la asistente.
INSERT INTO "Company" ("id", "name")
SELECT 'default', COALESCE(NULLIF((SELECT "value"->>'companyName' FROM "Setting" WHERE "key" = 'assistant'), ''), 'Empresa principal')
ON CONFLICT ("id") DO NOTHING;

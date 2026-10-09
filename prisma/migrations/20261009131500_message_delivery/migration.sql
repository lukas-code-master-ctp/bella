-- Mensajes por canales reales (WhatsApp): id externo y estado de entrega.
ALTER TABLE "Message" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Message" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "Message" ADD COLUMN "deliveryError" TEXT;

CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- Evita que dos servidores respondan a la vez al mismo lead.
ALTER TABLE "Lead" ADD COLUMN "agentBusyUntil" TIMESTAMP(3);

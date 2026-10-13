-- Ids de mensajes y comentarios de Meta: únicos por empresa, no en toda la base (el mismo número
-- o cuenta puede estar conectado en dos empresas).
CREATE UNIQUE INDEX "Message_companyId_externalId_key" ON "Message"("companyId", "externalId");
DROP INDEX "Message_externalId_key";

CREATE UNIQUE INDEX "SocialComment_companyId_externalId_key" ON "SocialComment"("companyId", "externalId");
DROP INDEX "SocialComment_externalId_key";

-- Conversiones: cuándo se tomó el envío, para reintentar las que quedaron en SENDING.
ALTER TABLE "ConversionEvent" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- Cerrar sesión invalida los tokens emitidos antes.
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

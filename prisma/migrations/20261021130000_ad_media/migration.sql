-- Imagen del anuncio por el que llegó el lead, para mostrarlo en el chat.
ALTER TABLE "LeadSource" ADD COLUMN "adMediaType" TEXT;
ALTER TABLE "LeadSource" ADD COLUMN "adImageUrl" TEXT;

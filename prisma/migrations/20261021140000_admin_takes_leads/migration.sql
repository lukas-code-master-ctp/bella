-- Admins que también reciben leads de la asignación automática (apagado por defecto).
ALTER TABLE "User" ADD COLUMN "takesLeads" BOOLEAN NOT NULL DEFAULT false;

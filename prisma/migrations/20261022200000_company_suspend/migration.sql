-- Empresas suspendidas o eliminadas desde Configuración → Empresas (aditivo: null = activa).
ALTER TABLE "Company" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "deletedAt" TIMESTAMP(3);

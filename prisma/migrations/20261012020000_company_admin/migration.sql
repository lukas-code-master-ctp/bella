-- Dueño de Bella: el primer administrador de la empresa por defecto (el que crea el seed).
ALTER TABLE "User" ADD COLUMN "superadmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "superadmin" = true
WHERE "id" = (
  SELECT "id" FROM "User"
  WHERE "companyId" = 'default' AND "role" = 'ADMIN' AND "active"
  ORDER BY "createdAt" ASC
  LIMIT 1
);

-- Los nombres pasan a ser únicos por empresa (índices creados en 20261012010000_company_settings).
DROP INDEX "Funnel_name_key";
DROP INDEX "Tag_category_name_key";
DROP INDEX "Contact_channel_externalId_key";
DROP INDEX "CustomField_name_key";
DROP INDEX "WeeklyInsight_periodEnd_key";

-- Configuración por empresa. "Setting" queda solo para el código anterior y se borra más adelante.
CREATE TABLE "CompanySetting" (
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("companyId","key")
);

INSERT INTO "CompanySetting" ("companyId", "key", "value")
SELECT "companyId", "key", "value" FROM "Setting"
ON CONFLICT DO NOTHING;

-- Únicos por empresa. Los únicos globales de antes se mantienen hasta que el código anterior deje de correr.
CREATE UNIQUE INDEX "Funnel_companyId_name_key" ON "Funnel"("companyId", "name");
CREATE UNIQUE INDEX "Tag_companyId_category_name_key" ON "Tag"("companyId", "category", "name");
CREATE UNIQUE INDEX "Contact_companyId_channel_externalId_key" ON "Contact"("companyId", "channel", "externalId");
CREATE UNIQUE INDEX "CustomField_companyId_name_key" ON "CustomField"("companyId", "name");
CREATE UNIQUE INDEX "WeeklyInsight_companyId_periodEnd_key" ON "WeeklyInsight"("companyId", "periodEnd");

-- Páginas y cuentas de Instagram conectadas con "Conectar con Meta", para repartir los avisos de
-- la app de la plataforma a cada empresa.
CREATE TABLE "MetaAccount" (
    "externalId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default',
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaAccount_pkey" PRIMARY KEY ("externalId")
);

CREATE INDEX "MetaAccount_companyId_idx" ON "MetaAccount"("companyId");

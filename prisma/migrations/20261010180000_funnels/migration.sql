-- Embudos: todas las etapas existentes quedan en el embudo "Principal" (id fijo "default", que
-- también es el valor por defecto de Stage.funnelId para que el código anterior siga creando etapas).
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "channels" "Channel"[],
    "assistantName" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Funnel_name_key" ON "Funnel"("name");

INSERT INTO "Funnel" ("id", "name", "position") VALUES ('default', 'Principal', 0);

ALTER TABLE "Stage" ADD COLUMN "funnelId" TEXT NOT NULL DEFAULT 'default';

-- El nombre de la etapa pasa a ser único dentro de su embudo.
DROP INDEX "Stage_name_key";
CREATE UNIQUE INDEX "Stage_funnelId_name_key" ON "Stage"("funnelId", "name");
CREATE INDEX "Stage_funnelId_position_idx" ON "Stage"("funnelId", "position");

ALTER TABLE "Stage" ADD CONSTRAINT "Stage_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

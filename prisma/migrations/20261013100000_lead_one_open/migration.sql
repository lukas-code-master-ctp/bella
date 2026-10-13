-- Un contacto tiene un solo lead abierto. Antes se cierran como perdidos los abiertos repetidos
-- (queda el más nuevo), para que el índice se pueda crear.
UPDATE "Lead" l
SET "status" = 'LOST', "closedAt" = NOW(), "aiEnabled" = false, "lostReason" = 'Duplicado'
WHERE l."status" = 'OPEN'
  AND EXISTS (
    SELECT 1 FROM "Lead" n
    WHERE n."contactId" = l."contactId" AND n."status" = 'OPEN'
      AND (n."createdAt", n."id") > (l."createdAt", l."id")
  );

-- Índice parcial: Prisma no lo puede declarar en schema.prisma, solo vive aquí.
CREATE UNIQUE INDEX "Lead_contactId_open_key" ON "Lead"("contactId") WHERE "status" = 'OPEN';

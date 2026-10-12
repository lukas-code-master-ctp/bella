-- Solo para la instalación de Lukas (en cualquier otra no hay usuarios con estos correos y no
-- cambia nada): el dueño de Bella (lukas@impulseai.cl) pasa a su propia empresa, vacía, y deja
-- Compra Tu Parcela en manos de su admin (l.rencoret@compratuparcela.cl).
INSERT INTO "Company" ("id", "name")
SELECT 'impulse-ai', 'Impulse AI'
WHERE EXISTS (SELECT 1 FROM "User" WHERE "email" = 'lukas@impulseai.cl')
ON CONFLICT ("id") DO NOTHING;

UPDATE "User" SET "superadmin" = false
WHERE EXISTS (SELECT 1 FROM "User" WHERE "email" = 'lukas@impulseai.cl');

UPDATE "User"
SET "companyId" = 'impulse-ai', "role" = 'ADMIN', "superadmin" = true, "active" = true
WHERE "email" = 'lukas@impulseai.cl';

UPDATE "User" SET "role" = 'ADMIN', "active" = true
WHERE "email" = 'l.rencoret@compratuparcela.cl';

ALTER TABLE "DataDeletionRequest" ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false;

-- Las solicitudes anteriores que no borraron nada se confirmaron igual: quedan para revisar.
UPDATE "DataDeletionRequest" SET "pending" = true WHERE "contacts" = 0 AND "comments" = 0;

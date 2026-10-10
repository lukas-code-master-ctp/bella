-- Regla de asignación cuando el cliente responde a un botón de plantilla de WhatsApp.
ALTER TYPE "RuleTrigger" ADD VALUE 'TEMPLATE_REPLY';

ALTER TABLE "AssignmentRule" ADD COLUMN "buttonText" TEXT,
ADD COLUMN "pauseAi" BOOLEAN NOT NULL DEFAULT false;

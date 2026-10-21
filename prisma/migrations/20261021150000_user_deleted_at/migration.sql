-- Usuarios eliminados: se conservan para el historial, pero no aparecen ni pueden entrar.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

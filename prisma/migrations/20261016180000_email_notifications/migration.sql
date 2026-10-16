-- Avisos por correo: preferencias por usuario y marca de envío por aviso.
ALTER TABLE "User" ADD COLUMN "emailNotifications" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Notification" ADD COLUMN "emailedAt" TIMESTAMP(3);

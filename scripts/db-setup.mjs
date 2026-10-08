// Migraciones y datos iniciales en el build. Los previews de Vercel comparten la base de
// producción: no deben migrarla (una rama sin mergear la cambiaría) ni competir con el build
// de producción por el bloqueo de migraciones, así que solo se corre en producción o fuera de Vercel.
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env && env !== "production") {
  console.log(`[db-setup] VERCEL_ENV=${env}: se omiten migraciones y seed.`);
} else {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}

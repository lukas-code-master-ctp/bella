/**
 * Datos iniciales: un admin y etapas y etiquetas de ejemplo. Es idempotente: solo crea lo que
 * falta, y corre en cada build. El admin se crea solo si SEED_ADMIN_PASSWORD está definida.
 *
 * La configuración de Compra Tu Parcela se carga solo en su instalación (SEED_PRESET o porque ya
 * se había cargado antes); una empresa nueva parte con la asistente en blanco.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { seedStarterData } from "../src/lib/domain/companies";
import { applyPreset } from "../src/lib/domain/presets";
import { getSetting } from "../src/lib/settings";
import { COMPRA_TU_PARCELA } from "../src/lib/presets/compra-tu-parcela";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@bella.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!(await db.user.findUnique({ where: { email } }))) {
    if (!password) {
      console.warn("SEED_ADMIN_PASSWORD no está definida: no se creó el usuario admin.");
    } else {
      await db.user.create({
        // El primer admin de una instalación nueva es el dueño de Bella (Configuración → Empresas).
        data: { name: "Administrador", email, role: "ADMIN", superadmin: true, passwordHash: await bcrypt.hash(password, 10) },
      });
      console.log(`Admin creado: ${email}`);
    }
  }

  // La empresa por defecto (fuera de una solicitud, `db` trabaja en ella).
  await seedStarterData();

  const preset = COMPRA_TU_PARCELA;
  const wanted =
    process.env.SEED_PRESET === preset.id || (await getSetting(`preset:${preset.id}`, null));
  if (wanted && (await applyPreset(db, preset))) {
    console.log(`Configuración "${preset.id}" v${preset.version} cargada.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

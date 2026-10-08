/**
 * Datos iniciales: un admin, etapas y etiquetas de ejemplo. Es idempotente:
 * solo crea lo que falta, y corre en cada build. El admin se crea solo si
 * SEED_ADMIN_PASSWORD está definida.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@bella.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!(await db.user.findUnique({ where: { email } }))) {
    if (!password) {
      console.warn("SEED_ADMIN_PASSWORD no está definida: no se creó el usuario admin.");
    } else {
      await db.user.create({
        data: { name: "Administrador", email, role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) },
      });
      console.log(`Admin creado: ${email}`);
    }
  }

  if ((await db.stage.count()) === 0) {
    const stages = [
      { name: "Nuevo", color: "#64748b" },
      { name: "Calificado", color: "#0ea5e9" },
      { name: "Interesado", color: "#8b5cf6" },
      { name: "Atención humana", color: "#f59e0b", requiresHuman: true },
    ];
    await db.stage.createMany({ data: stages.map((s, position) => ({ ...s, position })) });
    console.log("Etapas de ejemplo creadas.");
  }

  if ((await db.tag.count()) === 0) {
    await db.tag.createMany({
      data: [
        { category: "Interés", name: "Alto", color: "#16a34a" },
        { category: "Interés", name: "Medio", color: "#ca8a04" },
        { category: "Interés", name: "Bajo", color: "#dc2626" },
      ],
    });
    console.log("Etiquetas de interés creadas.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

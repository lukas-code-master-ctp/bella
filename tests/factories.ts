import { db } from "@/lib/db";

export async function seedFunnel() {
  const names = ["Nuevo", "Calificado", "Cotización", "Atención humana"];
  const stages = [];
  for (const [i, name] of names.entries()) {
    stages.push(
      await db.stage.create({ data: { name, position: i, requiresHuman: name === "Atención humana" } }),
    );
  }
  return stages;
}

export async function executive(name: string, extra: { active?: boolean } = {}) {
  return db.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}@test.cl`,
      passwordHash: "x",
      role: "EXECUTIVE",
      ...extra,
    },
  });
}

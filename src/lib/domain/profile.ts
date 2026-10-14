import bcrypt from "bcryptjs";
import { rootDb } from "../db";
import { DomainError } from "./leads";
import { MIN_PASSWORD_LENGTH } from "./password-reset";

/*
 * Mi perfil: cada usuario edita su nombre y cambia su contraseña. Va por `rootDb` porque es la
 * fila del propio usuario, que vive en su empresa aunque el dueño de Beliapp esté trabajando en otra.
 */

export async function updateOwnName(userId: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new DomainError("Escribe tu nombre.");
  if (clean.length > 80) throw new DomainError("El nombre es muy largo (máximo 80 caracteres).");
  return rootDb.user.update({ where: { id: userId }, data: { name: clean } });
}

/**
 * Cambia la contraseña pidiendo la actual. Marca `passwordChangedAt`, lo que cierra las sesiones
 * abiertas en otros dispositivos; quien llama vuelve a firmar la sesión actual.
 */
export async function changeOwnPassword(userId: string, current: string, next: string, now = new Date()) {
  const user = await rootDb.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw new DomainError("La contraseña actual no es correcta.");
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (next === current) throw new DomainError("La nueva contraseña debe ser distinta de la actual.");
  await rootDb.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: now },
  });
}

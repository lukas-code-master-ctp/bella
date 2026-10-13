import { rootDb } from "../db";

/**
 * Límite contra la fuerza bruta en el login: tras 10 claves erradas para un correo (o 30 desde una
 * misma IP) en 15 minutos, se rechaza sin comparar la clave hasta que pase la ventana.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 10;
const MAX_PER_IP = 30;

const since = () => new Date(Date.now() - WINDOW_MS);

export async function loginBlocked(email: string, ip: string | null): Promise<boolean> {
  const [byEmail, byIp] = await Promise.all([
    rootDb.loginAttempt.count({ where: { key: `email:${email}`, createdAt: { gte: since() } } }),
    ip ? rootDb.loginAttempt.count({ where: { key: `ip:${ip}`, createdAt: { gte: since() } } }) : 0,
  ]);
  return byEmail >= MAX_PER_EMAIL || byIp >= MAX_PER_IP;
}

export async function recordLoginFailure(email: string, ip: string | null) {
  await rootDb.loginAttempt.createMany({ data: [{ key: `email:${email}` }, ...(ip ? [{ key: `ip:${ip}` }] : [])] });
  // Los intentos viejos ya no cuentan: se borran aquí y la tabla no crece.
  await rootDb.loginAttempt.deleteMany({ where: { createdAt: { lt: since() } } });
}

/** Al entrar bien, los errores anteriores de ese correo dejan de contar. */
export async function clearLoginFailures(email: string) {
  await rootDb.loginAttempt.deleteMany({ where: { key: `email:${email}` } });
}

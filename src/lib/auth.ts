import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { rootDb } from "./db";
import { canWorkIn, companyActive } from "./domain/companies";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "./domain/login-attempts";
import { DEFAULT_COMPANY_ID } from "./tenant";
import {
  REMEMBER_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SHORT_MAX_AGE_SECONDS,
  readSession,
  sessionCookieOptions,
  sessionStale,
  signSession,
} from "./session-token";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

/**
 * `remember`: la sesión sobrevive al cierre del navegador por 30 días ("Recordarme").
 * `ip`: de quien intenta entrar, para el límite de intentos (login-attempts.ts).
 */
export async function login(
  email: string,
  password: string,
  remember = false,
  ip: string | null = null,
): Promise<"ok" | "wrong" | "blocked" | "suspended"> {
  email = email.trim().toLowerCase();
  if (await loginBlocked(email, ip)) return "blocked";
  // El correo es único entre todas las empresas: se busca sin filtro y la sesión lleva la empresa.
  const user = await rootDb.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    await recordLoginFailure(email, ip);
    return "wrong";
  }
  await clearLoginFailures(email);
  // Empresa suspendida o eliminada: su equipo no entra (el dueño de Beliapp, siempre).
  if (!user.superadmin && !(await companyActive(user.companyId))) return "suspended";
  const jar = await cookies();
  const maxAge = remember ? REMEMBER_MAX_AGE_SECONDS : SHORT_MAX_AGE_SECONDS;
  jar.set(SESSION_COOKIE, await signSession(user.id, maxAge, user.companyId), sessionCookieOptions(remember));
  return "ok";
}

/** Cierra la sesión en todos los dispositivos: un token copiado deja de valer aunque no venza. */
export async function logout() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (session) await rootDb.user.updateMany({ where: { id: session.userId }, data: { sessionsRevokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
}

// `cache`: el layout y la página piden el usuario en el mismo render; así se consulta una sola vez.
export const currentUser = cache(async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // Sin filtro de empresa: el dueño de Beliapp puede estar trabajando en otra empresa que la suya.
  const user = await rootDb.user.findUnique({ where: { id: session.userId } });
  if (!user?.active || sessionStale(session.issuedAt, user.passwordChangedAt)) return null;
  if (sessionStale(session.issuedAt, user.sessionsRevokedAt)) return null;
  const companyId = session.companyId ?? DEFAULT_COMPANY_ID;
  if (!canWorkIn(user, companyId)) return null;
  // Al suspender una empresa, las sesiones abiertas de su equipo dejan de valer al tiro.
  if (!user.superadmin && !(await companyActive(companyId))) return null;
  return user;
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/funnel");
  return user;
}

/** Dueño de Beliapp: Configuración → Empresas. */
export async function requireSuperadmin(): Promise<User> {
  const user = await requireAdmin();
  if (!user.superadmin) redirect("/settings");
  return user;
}

/** El dueño de Beliapp pasa a trabajar en otra empresa: la sesión se vuelve a firmar con ella. */
export async function enterCompany(user: User, companyId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user.id, SHORT_MAX_AGE_SECONDS, companyId), sessionCookieOptions(false));
}

/**
 * Vuelve a firmar la sesión actual (misma empresa y duración) después de cambiar la contraseña,
 * así este dispositivo sigue dentro y los demás quedan fuera.
 */
export async function renewSession() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return;
  const remember = session.maxAge > SHORT_MAX_AGE_SECONDS;
  const maxAge = remember ? REMEMBER_MAX_AGE_SECONDS : SHORT_MAX_AGE_SECONDS;
  jar.set(SESSION_COOKIE, await signSession(session.userId, maxAge, session.companyId ?? undefined), sessionCookieOptions(remember));
}

/** Un ejecutivo solo puede ver y operar sus leads asignados; el admin ve todo. */
export function canAccessLead(user: User, lead: { assigneeId: string | null }) {
  return user.role === "ADMIN" || lead.assigneeId === user.id;
}

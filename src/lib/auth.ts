import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db } from "./db";
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

/** `remember`: la sesión sobrevive al cierre del navegador por 30 días ("Recordarme"). */
export async function login(email: string, password: string, remember = false): Promise<boolean> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return false;
  if (!(await bcrypt.compare(password, user.passwordHash))) return false;
  const jar = await cookies();
  const maxAge = remember ? REMEMBER_MAX_AGE_SECONDS : SHORT_MAX_AGE_SECONDS;
  jar.set(SESSION_COOKIE, await signSession(user.id, maxAge), sessionCookieOptions(remember));
  return true;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// `cache`: el layout y la página piden el usuario en el mismo render; así se consulta una sola vez.
export const currentUser = cache(async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user?.active || sessionStale(session.issuedAt, user.passwordChangedAt)) return null;
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

/** Un ejecutivo solo puede ver y operar sus leads asignados; el admin ve todo. */
export function canAccessLead(user: User, lead: { assigneeId: string | null }) {
  return user.role === "ADMIN" || lead.assigneeId === user.id;
}

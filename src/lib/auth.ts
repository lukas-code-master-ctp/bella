import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db } from "./db";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "./session-token";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function login(email: string, password: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return false;
  if (!(await bcrypt.compare(password, user.passwordHash))) return false;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions);
  return true;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const userId = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  return user?.active ? user : null;
}

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

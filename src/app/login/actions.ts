"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";

export type LoginState = { error: string; email: string } | null;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  let ok: boolean;
  try {
    ok = await login(email, String(form.get("password") ?? ""));
  } catch (err) {
    // Errores de configuración del servidor: se muestran claros en vez de una página 500.
    console.error("[login]", err);
    return { error: loginErrorMessage(err), email };
  }
  if (!ok) return { error: "Correo o contraseña incorrectos.", email };
  redirect("/funnel");
}

function loginErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  const name = err instanceof Error ? err.name : "";
  if (message.includes("SESSION_SECRET")) {
    return "Falta configurar SESSION_SECRET en el servidor (mínimo 16 caracteres).";
  }
  if (name.startsWith("PrismaClient")) {
    return "No se pudo conectar a la base de datos. Revisa DATABASE_URL en el servidor.";
  }
  return "Error del servidor al iniciar sesión. Revisa los logs.";
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

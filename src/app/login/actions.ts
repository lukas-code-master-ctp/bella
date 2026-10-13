"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";
import { parseEmails } from "@/lib/email";
import { passwordResetAvailable, requestPasswordReset, resetPassword } from "@/lib/domain/password-reset";

export type LoginState = { error: string; email: string; remember: boolean } | null;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const remember = form.get("remember") === "on";
  let result: Awaited<ReturnType<typeof login>>;
  try {
    // En Vercel, el primer valor de x-forwarded-for es la IP real del cliente (lo pone Vercel).
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || null;
    result = await login(email, String(form.get("password") ?? ""), remember, ip);
  } catch (err) {
    // Errores de configuración del servidor: se muestran claros en vez de una página 500.
    console.error("[login]", err);
    return { error: loginErrorMessage(err), email, remember };
  }
  if (result === "blocked") return { error: "Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.", email, remember };
  if (result === "wrong") return { error: "Correo o contraseña incorrectos.", email, remember };
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

// Recuperar contraseña

export type ForgotState = { sent: boolean; error?: string; email: string } | null;

/** Origen de la app para el enlace. Sale de variables del servidor y no del Host del pedido. */
async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

export async function forgotPasswordAction(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get("email") ?? "").trim();
  if (!parseEmails(email).length) return { sent: false, error: "Escribe un correo válido.", email };
  if (!(await passwordResetAvailable())) {
    return { sent: false, error: "El envío de correos no está configurado. Pide a un administrador que te cambie la contraseña.", email };
  }
  try {
    await requestPasswordReset(email, await appOrigin());
  } catch (err) {
    console.error("[forgot-password]", err);
    return { sent: false, error: "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.", email };
  }
  // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
  return { sent: true, email };
}

export type ResetState = { error: string } | null;

export async function resetPasswordAction(_prev: ResetState, form: FormData): Promise<ResetState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "Las contraseñas no coinciden." };
  const result = await resetPassword(String(form.get("token") ?? ""), password);
  if (!result.ok) return { error: result.error };
  redirect("/login?restablecida=1");
}

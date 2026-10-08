"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";

export type LoginState = { error: string; email: string } | null;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const ok = await login(email, String(form.get("password") ?? ""));
  if (!ok) return { error: "Correo o contraseña incorrectos.", email };
  redirect("/funnel");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

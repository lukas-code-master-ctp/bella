import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { FormMessage } from "@/components/ui";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ restablecida?: string }> }) {
  if (await currentUser()) redirect("/funnel");
  const { restablecida } = await searchParams;
  return (
    <AuthShell title="Inicia sesión" description="Entra con tu correo de trabajo.">
      {restablecida && (
        <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
          <FormMessage tone="neutral">Listo, guardaste tu contraseña. Ya puedes entrar con ella.</FormMessage>
        </div>
      )}
      <LoginForm />
    </AuthShell>
  );
}

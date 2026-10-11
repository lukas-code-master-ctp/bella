import Link from "next/link";
import { passwordResetTokenValid } from "@/lib/domain/password-reset";
import { buttonClass } from "@/components/ui";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  if (!(await passwordResetTokenValid(token))) {
    return (
      <AuthShell title="Enlace vencido" description="Este enlace no es válido, ya se usó o pasó más de 1 hora.">
        <Link href="/login/recuperar" className={buttonClass("primary", "md", "w-full")}>
          Pedir un enlace nuevo
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Elige una nueva contraseña" description="Al guardarla se cierran las sesiones abiertas en otros dispositivos.">
      <ResetForm token={token} />
    </AuthShell>
  );
}

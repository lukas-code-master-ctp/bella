import Link from "next/link";
import { passwordResetTokenValid } from "@/lib/domain/password-reset";
import { buttonClass } from "@/components/ui";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; nueva?: string }> }) {
  const { token = "", nueva } = await searchParams;
  // `nueva`: invitación a una cuenta recién creada (vence en 7 días en vez de 1 hora).
  const invite = Boolean(nueva);
  if (!(await passwordResetTokenValid(token))) {
    return (
      <AuthShell
        title="Enlace vencido"
        description={invite ? "Este enlace no es válido, ya se usó o pasaron más de 7 días." : "Este enlace no es válido, ya se usó o pasó más de 1 hora."}
      >
        <Link href="/login/recuperar" className={buttonClass("primary", "md", "w-full")}>
          Pedir un enlace nuevo
        </Link>
      </AuthShell>
    );
  }
  if (invite) {
    return (
      <AuthShell title="Crea tu contraseña" description="Con ella y tu correo entras a Beliapp.">
        <ResetForm token={token} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Elige una nueva contraseña" description="Al guardarla se cierran las sesiones abiertas en otros dispositivos.">
      <ResetForm token={token} />
    </AuthShell>
  );
}

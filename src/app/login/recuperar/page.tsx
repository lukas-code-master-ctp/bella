import { AuthShell } from "../auth-shell";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Recupera tu contraseña" description="Te mandamos un enlace a tu correo para elegir una nueva.">
      <ForgotForm />
    </AuthShell>
  );
}

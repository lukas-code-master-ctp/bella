import { redirect } from "next/navigation";
import { Bot, SquareKanban, Users } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

const FEATURES = [
  { icon: Bot, text: "La asistente responde, califica y etiqueta cada lead al instante." },
  { icon: SquareKanban, text: "Funnel visual para seguir cada oportunidad hasta el cierre." },
  { icon: Users, text: "Asignación automática al ejecutivo correcto, sin perder ninguno." },
];

export default async function LoginPage() {
  if (await currentUser()) redirect("/funnel");
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(480px,560px)]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute -right-32 -top-32 size-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-40 -left-20 size-96 rounded-full bg-accent-600/20 blur-3xl" />
        <Logo inverted />
        <div className="relative mt-auto max-w-lg">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">Tus leads, atendidos al instante.</h2>
          <p className="mt-4 text-lg text-brand-100">CRM de leads con asistente IA, hecho para tu equipo de ventas.</p>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="pt-1.5 text-brand-50">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inicia sesión</h1>
          <p className="mt-1 text-sm text-slate-600">Entra con tu correo de trabajo.</p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}

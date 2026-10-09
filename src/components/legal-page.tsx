import { Logo } from "./logo";

/** Página pública y simple (política de privacidad, eliminación de datos): sin sesión. */
export function LegalPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-2xl animate-page-in rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-10">
        <Logo />
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {updated && <p className="mt-1 text-sm text-slate-500">Última actualización: {updated}</p>}
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline">
          {children}
        </div>
      </article>
    </main>
  );
}

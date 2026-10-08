import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/funnel");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-brand-600">Bella</div>
          <p className="mt-1 text-sm text-slate-500">CRM de leads con asistente IA</p>
        </div>
        <LoginForm />
      </Card>
    </main>
  );
}

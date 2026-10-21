import { KeyRound, MessageSquareText, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Avatar, Badge, PageHeader } from "@/components/ui";
import { Panel } from "@/components/settings-ui";
import { listQuickReplies } from "@/lib/domain/quick-replies";
import { NameForm, PasswordForm } from "./forms";
import { QuickReplies } from "./quick-replies";

export default async function ProfilePage() {
  const user = await requireUser();
  const quickReplies = await listQuickReplies(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Mi perfil" description="Tus datos y tu contraseña para entrar a Beliapp." />
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-rise">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {user.name}
            <Badge tone={user.role === "ADMIN" ? "brand" : "neutral"}>{user.role === "ADMIN" ? "Administrador" : "Ejecutivo"}</Badge>
          </p>
          <p className="truncate text-sm text-slate-600">{user.email}</p>
        </div>
      </div>
      <Panel icon={<UserRound />} title="Datos personales">
        <NameForm name={user.name} email={user.email} />
      </Panel>
      <Panel icon={<KeyRound />} title="Contraseña">
        <PasswordForm />
      </Panel>
      <Panel
        id="respuestas-rapidas"
        icon={<MessageSquareText />}
        title="Respuestas rápidas"
        description={'Mensajes pre-hechos para el chat. Escribe "/" en el chat de un lead para buscarlos por su nombre. Solo tú los ves.'}
      >
        <QuickReplies replies={quickReplies} />
      </Panel>
    </div>
  );
}

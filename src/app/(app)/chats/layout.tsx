import { requireUser } from "@/lib/auth";
import { countPendingComments } from "@/lib/domain/comments";
import { PageHeader } from "@/components/ui";
import { ChatsTabs } from "./tabs";

export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const pendingComments = await countPendingComments();
  return (
    <>
      <PageHeader title="Chats" description="Las conversaciones con tus leads, los comentarios de Instagram y Facebook, y el simulador para probar a la asistente." />
      <ChatsTabs pendingComments={pendingComments} />
      {children}
    </>
  );
}

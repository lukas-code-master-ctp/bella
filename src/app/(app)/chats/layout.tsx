import { requireUser } from "@/lib/auth";
import { countPendingComments } from "@/lib/domain/comments";
import { PageHeader } from "@/components/ui";
import { ChatsTabs } from "./tabs";

export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const pendingComments = await countPendingComments();
  return (
    <>
      <PageHeader title="Chats" description="Todas las conversaciones con tus leads y los comentarios de Instagram y Facebook, en un solo lugar." />
      <ChatsTabs pendingComments={pendingComments} />
      {children}
    </>
  );
}

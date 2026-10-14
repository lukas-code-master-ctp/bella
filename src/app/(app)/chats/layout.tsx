import { requireUser } from "@/lib/auth";
import { countPendingComments } from "@/lib/domain/comments";
import { ChatsTabs } from "./tabs";

export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const pendingComments = await countPendingComments();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Chats</h1>
        <ChatsTabs pendingComments={pendingComments} />
      </div>
      {children}
    </>
  );
}

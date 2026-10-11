import { redirect } from "next/navigation";

/** Los comentarios ahora viven en Chats → Comentarios; mantiene los enlaces antiguos. */
export default async function OldCommentsPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  redirect(ver === "resueltos" ? "/chats/comments?ver=resueltos" : "/chats/comments");
}

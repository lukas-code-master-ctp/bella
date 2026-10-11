"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, MessagesSquare } from "lucide-react";
import { LinkPending } from "@/components/link-pending";

/** Submenú de Chats: todas las conversaciones o los comentarios de Instagram y Facebook. */
export function ChatsTabs({ pendingComments }: { pendingComments: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/chats", label: "Todos los chats", icon: <MessageCircle />, active: pathname === "/chats", badge: 0 },
    { href: "/chats/comments", label: "Comentarios", icon: <MessagesSquare />, active: pathname.startsWith("/chats/comments"), badge: pendingComments },
  ];
  return (
    <nav aria-label="Chats" className="mb-6 flex w-full gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold sm:w-fit">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`relative flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 transition-colors duration-150 sm:flex-none [&_svg]:size-4 ${
            t.active ? "bg-white text-brand-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {t.icon}
          {t.label}
          {t.badge > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-white">
              <span className="sr-only">, </span>
              {t.badge}
              <span className="sr-only"> pendientes</span>
            </span>
          )}
          <LinkPending className="mx-3" />
        </Link>
      ))}
    </nav>
  );
}

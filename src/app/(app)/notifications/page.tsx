import Link from "next/link";
import { Bell, CheckCheck, ClockAlert, Hand, MessageCircle, UserPlus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { vapidPublicKey } from "@/lib/push";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { markAllReadAction } from "./actions";
import { PushToggle } from "./push-toggle";

const ICON: Record<string, React.ReactNode> = {
  HUMAN_STAGE: <Hand aria-hidden />,
  ASSIGNED: <UserPlus aria-hidden />,
  CONTACT_MESSAGE: <MessageCircle aria-hidden />,
  TASK_DUE: <ClockAlert aria-hidden />,
};

const time = (d: Date) =>
  d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Avisos"
        description="Leads que te asignaron, que pasaron a atención humana o que te escribieron mientras los atiendes tú."
      >
        {unread > 0 && (
          <form action={markAllReadAction}>
            <SubmitButton variant="secondary" pendingText="Marcando…">
              <CheckCheck aria-hidden />
              Marcar todo como leído
            </SubmitButton>
          </form>
        )}
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          {notifications.length === 0 ? (
            <EmptyState icon={<Bell />} title="Sin avisos por ahora">
              Te avisaremos aquí cuando un lead necesite a un ejecutivo.
            </EmptyState>
          ) : (
            <ul className="stagger divide-y divide-slate-100">
              {notifications.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/leads/${n.leadId}`}
                    className={`flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-slate-50 ${n.readAt ? "" : "bg-brand-50/60"}`}
                  >
                    <span
                      className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px] ${
                        n.readAt ? "bg-slate-100 text-slate-500" : "bg-brand-100 text-brand-700"
                      }`}
                    >
                      {ICON[n.type] ?? <Bell aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`truncate text-sm ${n.readAt ? "font-medium text-slate-700" : "font-semibold text-slate-900"}`}>
                          {n.title}
                        </span>
                        <time className="ml-auto shrink-0 text-xs text-slate-500" dateTime={n.createdAt.toISOString()}>
                          {time(n.createdAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span>
                    </span>
                    {!n.readAt && <span aria-label="Sin leer" className="mt-2 size-2 shrink-0 rounded-full bg-brand-600" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <PushToggle publicKey={vapidPublicKey()} isAdmin={user.role === "ADMIN"} />
      </div>
    </>
  );
}

import { Card, LoadingScreen, Skeleton } from "@/components/ui";

const BUBBLES = [
  { mine: false, w: "w-64" },
  { mine: true, w: "w-80" },
  { mine: false, w: "w-48" },
  { mine: true, w: "w-72" },
];

export default function LeadLoading() {
  return (
    <LoadingScreen label="Cargando la conversación…">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex h-[calc(100dvh-9rem)] min-h-[32rem] flex-col overflow-hidden lg:h-[calc(100dvh-4rem)]">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
            <Skeleton className="size-10" />
            <Skeleton className="size-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="ml-auto h-6 w-28 rounded-full" />
          </div>
          <div className="flex-1 space-y-4 bg-slate-50 px-4 py-5 sm:px-6">
            {BUBBLES.map((b, i) => (
              <div key={i} className={`flex ${b.mine ? "justify-end" : "justify-start"}`}>
                <Skeleton className={`h-16 max-w-[70%] rounded-2xl ${b.w}`} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t border-slate-200 p-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-24" />
          </div>
        </Card>
        <aside className="relative space-y-4 xl:h-[calc(100dvh-4rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1.5">
          <Card className="divide-y divide-slate-100">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </Card>
          <Card className="space-y-3 p-4">
            <Skeleton className="h-3 w-20" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </Card>
        </aside>
      </div>
    </LoadingScreen>
  );
}

import { LoadingScreen, Skeleton } from "@/components/ui";

export default function ChatsLoading() {
  return (
    <LoadingScreen label="Cargando los chats…">
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <div className="hidden space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:block">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-full" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-6 w-3/4" />
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-3">
            <Skeleton className="h-10 w-full" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3 border-b border-slate-100 px-4 py-3.5">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-5 w-48 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingScreen>
  );
}

import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function BroadcastLoading() {
  return (
    <LoadingScreen label="Cargando el envío…">
      <Skeleton className="mb-3 h-4 w-32" />
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white">
        <div className="flex gap-2 p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-6 border-t border-slate-100 px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

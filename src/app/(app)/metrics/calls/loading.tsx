import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function CallsLoading() {
  return (
    <LoadingScreen label="Cargando las llamadas…">
      <PageHeaderSkeleton />
      <div className="mb-6 flex gap-2">
        <Skeleton className="h-10 flex-1 sm:w-44 sm:flex-none" />
        <Skeleton className="h-10 flex-1 sm:w-44 sm:flex-none" />
      </div>
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <Skeleton className="h-4 w-36" />
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="h-3 w-full" />
            ))}
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

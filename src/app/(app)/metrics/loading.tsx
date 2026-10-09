import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function MetricsLoading() {
  return (
    <LoadingScreen label="Cargando las métricas…">
      <PageHeaderSkeleton />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <Skeleton className="h-4 w-32" />
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="space-y-1.5">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-2.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </LoadingScreen>
  );
}

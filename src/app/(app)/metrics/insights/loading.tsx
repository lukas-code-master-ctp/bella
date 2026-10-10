import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function InsightsLoading() {
  return (
    <LoadingScreen label="Cargando el resumen semanal…">
      <PageHeaderSkeleton />
      <div className="space-y-6">
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <Skeleton className="h-4 w-36" />
              {Array.from({ length: 3 }, (_, j) => (
                <Skeleton key={j} className="h-3 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </LoadingScreen>
  );
}

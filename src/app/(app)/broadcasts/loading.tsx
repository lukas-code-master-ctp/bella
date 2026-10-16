import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function BroadcastsLoading() {
  return (
    <LoadingScreen label="Cargando los envíos…">
      <PageHeaderSkeleton />
      <div className="rounded-xl border border-slate-200 bg-white">
        <Skeleton className="h-10 rounded-b-none rounded-t-xl" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-t border-slate-100 px-4 py-3.5">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-2 w-32 rounded-full" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

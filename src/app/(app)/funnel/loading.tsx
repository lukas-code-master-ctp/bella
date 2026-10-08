import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

const COLUMNS = [3, 2, 2, 1];

export default function FunnelLoading() {
  return (
    <LoadingScreen label="Cargando el funnel…">
      <PageHeaderSkeleton />
      <div className="mb-6 flex flex-wrap gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-36 rounded-xl" />
        ))}
      </div>
      <div className="-mx-4 flex gap-4 overflow-hidden px-4 sm:mx-0 sm:px-0">
        {COLUMNS.map((cards, i) => (
          <div key={i} className="flex w-[288px] shrink-0 flex-col gap-2 rounded-xl bg-slate-100 p-2">
            <div className="flex items-center gap-2 px-1 py-1.5">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-5 w-7 rounded-full" />
            </div>
            {Array.from({ length: cards }, (_, j) => (
              <div key={j} className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex justify-between gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-10 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <div className="flex items-center gap-2 border-t border-slate-100 pt-2.5">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="ml-auto h-3 w-14" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

const GROUPS = [2, 3, 2];

export default function TasksLoading() {
  return (
    <LoadingScreen label="Cargando las tareas…">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((rows, i) => (
          <div key={i} className="self-start rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
              <Skeleton className="size-7" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-5 w-7 rounded-full" />
            </div>
            {Array.from({ length: rows }, (_, j) => (
              <div key={j} className="flex gap-3 px-4 py-3">
                <Skeleton className="size-5 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

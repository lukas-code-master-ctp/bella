import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function NewBroadcastLoading() {
  return (
    <LoadingScreen label="Cargando las plantillas…">
      <Skeleton className="mb-3 h-4 w-32" />
      <PageHeaderSkeleton action={false} />
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-36 rounded-full" />
        ))}
      </div>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </LoadingScreen>
  );
}

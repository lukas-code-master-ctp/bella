import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function CommentsLoading() {
  return (
    <LoadingScreen label="Cargando los comentarios…">
      <PageHeaderSkeleton />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ml-auto h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

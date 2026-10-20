import { LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function TemplatesLoading() {
  return (
    <LoadingScreen label="Cargando las plantillas…">
      <Skeleton className="mb-3 h-4 w-32" />
      <PageHeaderSkeleton />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}

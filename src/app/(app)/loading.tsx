import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <LoadingScreen>
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-4 p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-40" />
          </Card>
        ))}
      </div>
    </LoadingScreen>
  );
}

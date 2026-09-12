import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/ui/skeleton";

/** Route-level loading skeleton shown while a CRM section streams in. */
export default function CrmLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Загрузка раздела">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-6 w-24" />
      </div>
      <SkeletonRows rows={6} />
    </div>
  );
}

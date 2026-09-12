import { cn } from "@/lib/cn";

/** The glowing current-position marker on the route. Decorative (aria-hidden);
 *  the level it represents is conveyed by text (module progress + SR list). */
export function RouteNode({ className }: { className?: string }) {
  return <span className={cn("rnode", className)} aria-hidden="true" />;
}

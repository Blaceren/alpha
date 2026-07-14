import { cn } from "@/lib/cn";

/**
 * The one primary action, styled as a route action marker (belongs to the route,
 * restrained signal, small arrow cell). In D1B the lesson/checkpoint destinations
 * are not built yet, so this is a focusable no-op button (development-safe: no 404,
 * no fake success). Documented in docs/D1B_REACT_HOME_IMPLEMENTATION.md.
 */
export function PrimaryRouteAction({
  label,
  block = false,
}: {
  label: string;
  block?: boolean;
}) {
  return (
    <button type="button" className={cn("cta", block && "block")}>
      {label}
      <span className="go" aria-hidden="true">
        →
      </span>
    </button>
  );
}

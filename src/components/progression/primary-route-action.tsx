import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The one primary action, styled as a route action marker (belongs to the route,
 * restrained signal, small arrow cell).
 *
 * With `href` it is a real link — D2B built the lesson route, so «Продолжить
 * урок» now goes to the lesson instead of doing nothing. Without `href` it stays
 * the development-safe no-op button from D1B: destinations that are not built
 * yet (checkpoint verification) must not 404 and must not fake success.
 *
 * Both branches render the same classes, so the Home composition is unchanged.
 */
export function PrimaryRouteAction({
  label,
  href,
  block = false,
}: {
  label: string;
  href?: string;
  block?: boolean;
}) {
  const className = cn("cta", block && "block");
  const arrow = (
    <span className="go" aria-hidden="true">
      →
    </span>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {label}
        {arrow}
      </Link>
    );
  }

  return (
    <button type="button" className={className}>
      {label}
      {arrow}
    </button>
  );
}

/** The route fading on toward the distant/next module field. Decorative. */
export function RouteContinuation({ d }: { d: string }) {
  return <path className="route-line rc-distant" d={d} vectorEffect="non-scaling-stroke" />;
}

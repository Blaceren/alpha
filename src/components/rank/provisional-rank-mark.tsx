/**
 * PROVISIONAL rank mark — minimal: a single route node on a short trace.
 * NOT the Route Knot, NOT nested squares, no family logic, no amount. This is a
 * placeholder for the current rank; the real rank identity is a separate future
 * phase (see docs/RANK_IDENTITY_FUTURE_PHASE.md). Always shown next to the rank text.
 */
export function ProvisionalRankMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="rankmark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Знак ранга (провизорный)"
    >
      <path
        d="M3 20 C 7.5 18.5, 10.5 13, 14.5 9.5"
        fill="none"
        stroke="var(--route-completed)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="8" r="3.4" fill="none" stroke="var(--signal-active)" strokeWidth="2" />
      <circle cx="16.5" cy="8" r="1.4" fill="var(--signal-active)" />
    </svg>
  );
}

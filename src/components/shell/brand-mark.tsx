/** Provisional Alfa Trade Academy wordmark (route glyph + name). Replaceable by a real logo. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1.5" y="1.5" width="21" height="21" rx="7" fill="none" stroke="var(--gate-boundary)" strokeWidth="1.5" />
        <polyline points="6,16 10,11 13,13.5 18,7" fill="none" stroke="var(--signal-active)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && "Alfa Trade Academy"}
    </span>
  );
}

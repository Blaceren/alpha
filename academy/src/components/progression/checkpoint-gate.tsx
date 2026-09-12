/**
 * The checkpoint gate as a structural boundary object: two offset vertical planes
 * with a light aperture between them (near / boundary / far). Self-contained SVG
 * scaled by CSS height (no CSS scale()). Decorative — meaning is in the text.
 */
export function CheckpointGate() {
  return (
    <div className="checkpoint-gate" aria-hidden="true">
      <svg viewBox="0 0 90 360" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="cg-ap" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--signal-active)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--signal-active)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* aperture between the planes */}
        <ellipse cx="42" cy="180" rx="30" ry="150" fill="url(#cg-ap)" />
        <ellipse cx="44" cy="180" rx="18" ry="120" fill="none" stroke="var(--signal-active)" strokeWidth="1.5" opacity="0.65" />
        {/* first boundary plane (front) */}
        <line x1="34" y1="14" x2="34" y2="346" stroke="var(--gate-boundary)" strokeWidth="2.5" opacity="0.9" />
        {/* second boundary plane (offset, back) */}
        <line x1="60" y1="46" x2="60" y2="314" stroke="var(--gate-boundary)" strokeWidth="2.5" opacity="0.5" />
        {/* stopped route endpoint arriving at the near side */}
        <line x1="20" y1="300" x2="34" y2="300" stroke="var(--signal-active)" strokeWidth="3" />
        <circle cx="20" cy="300" r="4" fill="var(--signal-active)" />
      </svg>
    </div>
  );
}

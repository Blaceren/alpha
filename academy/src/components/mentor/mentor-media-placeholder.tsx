/**
 * Provisional cinematic media placeholder for Alex Curie — a neutral backlit
 * silhouette with directional light and an explicit replaceable asset slot.
 * No real/random person, no facial features. Carries an aria-label; the mentor's
 * name lives as separate text. Contains no important text baked into the image.
 */
export function MentorMediaPlaceholder({ size = 56 }: { size?: number }) {
  return (
    <span className="mentor-frame" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Alex Curie — медиа (заменяемый ассет)">
        <defs>
          <linearGradient id={`mm-ld-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#33465f" />
            <stop offset="0.5" stopColor="#151f30" />
            <stop offset="1" stopColor="#0b1220" />
          </linearGradient>
          <radialGradient id={`mm-rim-${size}`} cx="28%" cy="16%" r="62%">
            <stop offset="0" stopColor="#9cc0ea" stopOpacity="0.55" />
            <stop offset="1" stopColor="#9cc0ea" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#mm-ld-${size})`} />
        <ellipse cx="30" cy="18" rx="46" ry="40" fill={`url(#mm-rim-${size})`} />
        <path d="M14 100 C 17 64, 33 52, 50 52 C 67 52, 83 64, 86 100 Z" fill="#0a101c" fillOpacity="0.62" />
        <path d="M38 56 C 38 40, 62 40, 62 56 C 62 66, 38 66, 38 56 Z" fill="#0a101c" fillOpacity="0.55" />
        <path d="M38 56 C 38 42, 50 40, 55 41" stroke="#9cc0ea" strokeOpacity="0.35" strokeWidth="1.4" fill="none" />
      </svg>
    </span>
  );
}

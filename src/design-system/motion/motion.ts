/**
 * Provisional motion tokens (Phase D1A: functional-only, no milestone scenes).
 * Durations mirror --motion-* CSS variables. Emotional/milestone motion
 * (rank-up, checkpoint) is intentionally out of scope for D1A.
 */

export const MOTION = {
  fast: 140,
  base: 200,
  slow: 240,
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/** Tailwind transition helpers used across the shell and previews. */
export const TRANSITION = {
  colors: "transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
  transform: "transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
  soft: "transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
} as const;

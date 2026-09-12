/**
 * Financial checkpoint grid (real balance, USD) from Project Context §4.3.
 * After level 100 the grid is intentionally undefined (DECISIONS D-10).
 */
export const CHECKPOINT_GRID_USD: Record<number, number> = {
  4: 50,
  10: 100,
  15: 150,
  20: 200,
  25: 300,
  30: 400,
  35: 500,
  40: 750,
  45: 1000,
  50: 1500,
  55: 2000,
  60: 2500,
  65: 3000,
  70: 4000,
  75: 5000,
  80: 6000,
  85: 7000,
  90: 8000,
  95: 9000,
  100: 10000,
};

const CHECKPOINT_LEVELS = Object.keys(CHECKPOINT_GRID_USD)
  .map(Number)
  .sort((a, b) => a - b);

/** The next checkpoint at or after `level`, or null when past level 100. */
export function nextCheckpointForLevel(
  level: number,
): { level: number; requiredUsd: number } | null {
  for (const cp of CHECKPOINT_LEVELS) {
    if (cp >= level) return { level: cp, requiredUsd: CHECKPOINT_GRID_USD[cp]! };
  }
  return null; // future_checkpoint_not_defined territory (> level 100)
}

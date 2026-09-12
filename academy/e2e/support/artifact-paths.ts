import path from "node:path";

/**
 * Single source of truth for E2E screenshot output (TB2-F-002).
 *
 * Screenshot specs previously wrote PNGs directly into the tracked
 * `design-memory/screenshots/` tree, so a broad E2E run dirtied Git. All
 * screenshot output now resolves under `SCREENSHOT_ROOT`, which lives in the
 * gitignored `test-results/` directory. Failure artifacts remain available on
 * disk, just outside version control. Override with `ACADEMY_SCREENSHOT_DIR`.
 */
export const SCREENSHOT_ROOT = path.resolve(
  process.env.ACADEMY_SCREENSHOT_DIR?.trim() || "test-results/screenshots",
);

export function screenshotDir(...segments: string[]): string {
  return path.join(SCREENSHOT_ROOT, ...segments);
}

/**
 * True when `dir` is inside the ignored screenshot root and NOT under the
 * tracked `design-memory/` tree. Used by the regression test.
 */
export function isIgnoredArtifactPath(dir: string): boolean {
  const resolved = path.resolve(dir);
  const rel = path.relative(SCREENSHOT_ROOT, resolved);
  const withinRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  return withinRoot && !resolved.includes(`${path.sep}design-memory${path.sep}`);
}

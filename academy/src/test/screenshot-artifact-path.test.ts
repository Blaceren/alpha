import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCREENSHOT_ROOT,
  screenshotDir,
  isIgnoredArtifactPath,
} from "../../e2e/support/artifact-paths";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * TB2-F-002 regression: a broad Academy E2E run must never write PNGs into the
 * tracked design-memory/ tree. Screenshot output is centralized in
 * e2e/support/artifact-paths.ts and must resolve under the gitignored
 * test-results/ directory.
 */
describe("screenshot artifact path (TB2-F-002)", () => {
  it("resolves the screenshot root under the ignored test-results directory", () => {
    const rel = path.relative(REPO_ROOT, SCREENSHOT_ROOT);
    expect(rel.split(path.sep)[0]).toBe("test-results");
  });

  it("never resolves under design-memory", () => {
    expect(SCREENSHOT_ROOT).not.toContain(`${path.sep}design-memory${path.sep}`);
    expect(isIgnoredArtifactPath(screenshotDir("d4-trading-journal", "final"))).toBe(true);
  });

  it("flags a design-memory path as NOT an ignored artifact path", () => {
    expect(isIgnoredArtifactPath(path.resolve(REPO_ROOT, "design-memory/screenshots/x"))).toBe(false);
  });

  it("test-results is gitignored", () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\/?test-results\/?$/m);
  });

  it("every screenshot spec derives its output from screenshotDir(), not a design-memory literal", () => {
    const e2eDir = path.join(REPO_ROOT, "e2e");
    const specs = fs.readdirSync(e2eDir).filter((f) => f.endsWith("-screenshots.spec.ts") || f === "screenshots.spec.ts");
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const source = fs.readFileSync(path.join(e2eDir, spec), "utf8");
      const outMatch = source.match(/const OUT =.*/);
      expect(outMatch, `${spec} has an OUT definition`).not.toBeNull();
      expect(outMatch![0], `${spec} OUT uses screenshotDir`).toContain("screenshotDir(");
      // No code line (outside comments) may reference the tracked screenshots tree.
      const codeLines = source
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
      expect(codeLines.join("\n"), `${spec} code has no design-memory literal`).not.toContain(
        "design-memory/screenshots",
      );
    }
  });
});

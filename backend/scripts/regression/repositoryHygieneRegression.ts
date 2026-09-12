/**
 * ATA-STORAGE-RELEASE-HYGIENE-CACHE-SEED-1 — generated build cache stays OUT of
 * the repository.
 *
 * WHAT WENT WRONG. `.gitignore` carried `.next/`, which does not cover the
 * sibling path `.next-cache-seed/`. 447 MiB of webpack packs were committed —
 * along with `.previewinfo` and `.rscinfo`, which hold Next's preview-mode
 * signing/encryption keys and an RSC encryption key. Because they were TRACKED,
 * the publisher was right to ship them: excluding tracked files would have
 * broken the release-matches-git guarantee. So the correction had to happen in
 * the repository, not in the packaging.
 *
 * WHY THIS TEST EXISTS RATHER THAN A COMMENT. The failure mode is silent: a
 * `git add -A` in a workspace with a fresh cache directory re-commits hundreds
 * of megabytes, and nobody notices until a release is measured months later.
 * This asserts the invariant on every run.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");
let passes = 0;
let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

function tracked(pathspec: string): string[] {
  const out = execFileSync("git", ["ls-files", "--", pathspec], { cwd: REPO, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

console.log("\nrepository hygiene regression\n");

check("no tracked files under .next-cache-seed", () => {
  const files = tracked(".next-cache-seed");
  assert.deepEqual(files, [], `${files.length} generated cache file(s) are tracked: ${files.slice(0, 3).join(", ")}`);
});

check("no tracked files under .next/cache", () => {
  const files = tracked(".next/cache");
  assert.deepEqual(files, [], `${files.length} tracked build-cache file(s)`);
});

check("no tracked webpack pack files anywhere", () => {
  // The shape that caused this, independent of the directory it lands in.
  const files = tracked("*.pack").concat(tracked("*.pack.old"));
  assert.deepEqual(files, [], `tracked webpack packs: ${files.slice(0, 3).join(", ")}`);
});

check("Next preview/RSC key files are not tracked", () => {
  // These rotate on every build; a committed copy is a stale secret, not config.
  const files = tracked("*.previewinfo").concat(tracked("*.rscinfo"));
  assert.deepEqual(files, [], `tracked key material: ${files.join(", ")}`);
});

check(".gitignore covers the cache-seed path", () => {
  const ignored = execFileSync("git", ["check-ignore", "-q", ".next-cache-seed/probe.pack"], {
    cwd: REPO,
    encoding: "utf8",
  });
  void ignored;
});

check("runtime build output remains publishable", () => {
  // The rule must not have become "ignore everything under .next-*". The
  // publisher needs these, and they are produced by the build, not tracked.
  for (const required of ["server", "static", "BUILD_ID", "routes-manifest.json"]) {
    const isIgnored = (() => {
      try {
        execFileSync("git", ["check-ignore", "-q", `.next/${required}`], { cwd: REPO });
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(isIgnored, true, `.next/${required} should be git-ignored build output, not tracked`);
  }
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;

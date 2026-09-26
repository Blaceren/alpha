/**
 * Recompute a package's `contentFingerprint` in place.
 *
 *   tsx scripts/curriculum/fingerprintCurriculumPackage.ts <package.json> [--check]
 *
 * `--check` exits non-zero on mismatch instead of rewriting, so CI can pin a
 * package without granting it write access.
 */
import fs from "node:fs";
import { calculateFingerprint } from "../../src/lib/curriculum/package/fingerprint";
import { curriculumPackageSchema } from "../../src/lib/curriculum/package/schema";

const file = process.argv[2];
const checkOnly = process.argv.includes("--check");
if (!file) throw new Error("usage: fingerprintCurriculumPackage.ts <package.json> [--check]");

const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
// Parse with a throwaway fingerprint so schema errors surface before hashing.
// The canonical projection excludes `contentFingerprint`, so its value here is
// irrelevant to the result.
const parsed = curriculumPackageSchema.parse({ ...raw, contentFingerprint: "0".repeat(64) });
const fingerprint = calculateFingerprint(parsed);

if (checkOnly) {
  if (raw.contentFingerprint !== fingerprint) {
    console.error(`fingerprint mismatch\n  declared:   ${String(raw.contentFingerprint)}\n  calculated: ${fingerprint}`);
    process.exitCode = 1;
  } else {
    console.log(`ok ${fingerprint}`);
  }
} else {
  fs.writeFileSync(file, `${JSON.stringify({ ...raw, contentFingerprint: fingerprint }, null, 2)}\n`);
  console.log(`fingerprint ${fingerprint}`);
}

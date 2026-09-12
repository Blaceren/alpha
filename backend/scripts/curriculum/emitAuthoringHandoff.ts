/**
 * PHASE-G1 — emit a deterministic AUTHORING HANDOFF BUNDLE to disk.
 *
 * THE BROWSER NEVER REACHES GIT (§38). The HTTP route returns a bundle as JSON
 * so an authorized operator can inspect or download it; this CLI is the only
 * thing that writes one into the repository, and a human runs it from a shell
 * with the repository checked out. There is no path from a request to a commit.
 *
 *   npm run curriculum:authoring:handoff -- --out curriculum/candidates/<name>.json
 *   npm run curriculum:authoring:handoff -- --levels 5,6,7
 *   npm run curriculum:authoring:handoff -- --check curriculum/candidates/<name>.json
 *
 * `--check` re-emits from the same database and compares byte-for-byte with the
 * checked-in artifact, which is how bundle drift is caught in CI rather than at
 * merge time — the same discipline `buildCanonical100 --check` already applies.
 *
 * IT WRITES NO CURRICULUM ROW. The only database write on this path is the audit
 * record, and the CLI passes `actorId: null`, so a shell run writes nothing at
 * all. It publishes nothing, imports nothing and activates nothing.
 *
 * DATABASE_URL must point at a disposable or operator-chosen database. This
 * script does not choose one and has no default.
 */
import fs from "node:fs";
import path from "node:path";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required. This script has no default database.");
    process.exitCode = 1;
    return;
  }

  const { buildHandoffBundle } = await import("@/lib/curriculum/authoring-handoff");
  const { resolveAuthoringCurriculumVersionId } = await import("@/lib/curriculum/authoring-read");
  const { prisma } = await import("@/lib/prisma");

  try {
    const explicit = arg("curriculum-version-id");
    const curriculumVersionId = explicit
      ? Number(explicit)
      : await resolveAuthoringCurriculumVersionId();
    if (!curriculumVersionId) {
      console.error("no curriculum version found in this database");
      process.exitCode = 1;
      return;
    }

    const levelsArg = arg("levels");
    const levelNumbers = levelsArg
      ? levelsArg
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
      : undefined;

    const bundle = await buildHandoffBundle({
      curriculumVersionId,
      levelNumbers,
      // A shell run has no HTTP actor and must not invent one.
      actorId: null,
    });

    // Two spaces and a trailing newline, exactly like every other checked-in
    // curriculum artifact, so a diff of two bundles is readable.
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;

    const checkPath = arg("check");
    if (checkPath) {
      const existing = fs.readFileSync(path.resolve(checkPath), "utf8");
      if (existing !== serialized) {
        console.error(`handoff bundle drift: ${checkPath} does not match the current durable state`);
        process.exitCode = 1;
        return;
      }
      console.log(`ok   ${checkPath} matches (fingerprint ${bundle.fingerprint})`);
      return;
    }

    const outPath = arg("out");
    if (outPath) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(path.resolve(outPath), serialized, "utf8");
      console.log(`wrote ${outPath}`);
    } else {
      process.stdout.write(serialized);
    }

    console.error(
      [
        `fingerprint       ${bundle.fingerprint}`,
        `curriculum        ${bundle.curriculumVersionCode} v${bundle.curriculumVersionNumber}`,
        `levels included   ${bundle.counts.included}`,
        `levels excluded   ${bundle.counts.excluded}`,
        "",
        "THIS IS NOT A PUBLICATION. The bundle activates nothing, imports nothing",
        "and changes no runtime state. Merging it into the canonical package is a",
        "separate, source-controlled engineering step.",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

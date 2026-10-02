/**
 * PROGRAM STRUCTURE (2026-10-02) — move learners onto the published program.
 *
 *   tsx scripts/ops/moveLearnersToPublishedProgram.ts \
 *     (--user-id 73 [--user-id 74 …] | --all-on-version 4) \
 *     --reason "Перенос на программу 1–30 по решению владельца 2026-10-02" \
 *     [--apply]
 *
 * WITHOUT `--apply` IT ONLY PLANS: for each learner it prints what would
 * happen — which version they are on, how many levels would carry, how much XP
 * — and writes nothing. With `--apply` it moves them, one transaction each, so
 * one learner who cannot be moved never undoes another who was.
 *
 * It prints user IDS and counts. No e-mail, no name, no Pocket value.
 *
 * What a move is, and what it refuses, is in `src/lib/curriculum/enrollment-move.ts`.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_CURRICULUM_CODE } from "../../src/lib/curriculum/constants";
import { moveEnrollmentToPublishedVersion } from "../../src/lib/curriculum/enrollment-move";

class UsageError extends Error {}

function values(argv: string[], name: string): string[] {
  const found: string[] = [];
  argv.forEach((argument, index) => {
    if (argument !== name) return;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
    found.push(value);
  });
  return found;
}

function positive(raw: string, name: string): number {
  if (!/^[1-9]\d{0,8}$/.test(raw)) throw new UsageError(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return Number(raw);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const reasons = values(argv, "--reason");
  if (reasons.length !== 1) throw new UsageError("--reason is required, once");
  const userIds = values(argv, "--user-id").map((raw) => positive(raw, "--user-id"));
  const versions = values(argv, "--all-on-version").map((raw) => positive(raw, "--all-on-version"));
  if ((userIds.length > 0) === (versions.length > 0) || versions.length > 1) {
    throw new UsageError("name learners with --user-id, or one version with --all-on-version — exactly one of the two");
  }

  const prisma = new PrismaClient();
  try {
    let targets = userIds;
    if (versions.length === 1) {
      const rows = await prisma.userCurriculumEnrollment.findMany({
        where: {
          curriculumCode: DEFAULT_CURRICULUM_CODE,
          status: "active",
          curriculumVersion: { versionNumber: versions[0] },
        },
        select: { userId: true },
        orderBy: { userId: "asc" },
      });
      targets = rows.map((row) => row.userId);
    }

    const results = [];
    const counts: Record<string, number> = {};
    for (const userId of [...new Set(targets)]) {
      try {
        const plan = await moveEnrollmentToPublishedVersion({
          userId,
          reason: reasons[0],
          dryRun: !apply,
          db: prisma,
        });
        results.push(plan);
        counts[plan.outcome] = (counts[plan.outcome] ?? 0) + 1;
      } catch (error) {
        counts.failed = (counts.failed ?? 0) + 1;
        results.push({ outcome: "failed", userId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", learners: results.length, counts, results }, null, 2));
    if (counts.failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof UsageError ? `usage: ${error.message}` : error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});

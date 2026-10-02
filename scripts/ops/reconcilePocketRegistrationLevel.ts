/**
 * L1OWNER-1 — server-local reconciliation for learners whose Pocket identity was
 * bound before the Level 1 completion owner existed.
 *
 * It calls the SAME legal reconciliation service the postback calls. It never
 * writes UserLevelProgress, never fabricates an identity, never creates XP, and
 * never prints a Pocket user id or a clickid.
 */
import { prisma } from "@/lib/prisma";
import { reconcilePocketRegistrationLevelCompletion } from "@/lib/curriculum/pocket-registration-completion";

const BATCH = 200;

type Counts = Record<string, number>;

async function candidates(learnerId?: number) {
  const identities = await prisma.pocketTraderIdentity.findMany({
    where: learnerId ? { userId: learnerId } : undefined,
    select: { userId: true },
    orderBy: { userId: "asc" },
    take: learnerId ? 1 : BATCH,
  });
  return identities.map((i) => i.userId);
}

async function classify(userId: number): Promise<string> {
  const enrolment = await prisma.userCurriculumEnrollment.findFirst({
    where: { userId, status: "active" }, select: { id: true, curriculumVersionId: true, currentLevel: true },
  });
  if (!enrolment) return "missing_enrollment";
  // The registration level is found the way the service finds it: by its
  // completion pair in the learner's own version, exactly one.
  const levels = await prisma.levelDefinition.findMany({
    where: {
      curriculumVersionId: enrolment.curriculumVersionId,
      type: "external_event",
      completionMethod: "pocket_postback",
    },
    take: 2,
    select: { id: true, levelNumber: true },
  });
  if (levels.length !== 1) return "configuration_conflict";
  const level = levels[0];
  const p = await prisma.userLevelProgress.findFirst({
    where: { enrollmentId: enrolment.id, levelDefinitionId: level.id }, select: { status: true },
  });
  if (p?.status === "completed") return "already_completed";
  // A learner who has not reached the level yet has nothing to reconcile.
  return enrolment.currentLevel === level.levelNumber ? "eligible" : "not_reached";
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const learnerFlag = argv.indexOf("--learner");
  const learnerId = learnerFlag >= 0 ? Number(argv[learnerFlag + 1]) : undefined;
  if (learnerFlag >= 0 && (!Number.isSafeInteger(learnerId!) || learnerId! <= 0)) {
    console.error("--learner must be a positive integer"); process.exit(2);
  }

  const ids = await candidates(learnerId);
  const counts: Counts = { eligible: 0, already_completed: 0, not_reached: 0, missing_enrollment: 0, configuration_conflict: 0 };
  const eligible: number[] = [];
  for (const id of ids) {
    const c = await classify(id);
    counts[c] = (counts[c] ?? 0) + 1;
    if (c === "eligible") eligible.push(id);
  }

  if (!apply) {
    // Counts only. No Pocket id, no clickid, no learner list.
    console.log(JSON.stringify({ mode: "dry-run", scanned: ids.length, ...counts }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const outcomes: Counts = {};
  let failures = 0;
  for (const id of eligible) {
    const r = await reconcilePocketRegistrationLevelCompletion(id);
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.outcome === "transient_failure" || r.outcome === "configuration_error") failures += 1;
  }
  console.log(JSON.stringify({ mode: "apply", scanned: ids.length, attempted: eligible.length, outcomes }, null, 2));
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

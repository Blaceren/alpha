/**
 * LOCAL DEVELOPMENT ONLY — bring an imported curriculum package to a served state.
 *
 * `curriculum:package:import` lands every content version, assessment version,
 * rubric and report assignment as `draft`, and the curriculum publish gate
 * refuses a version whose bound resources are still drafts.
 *
 * The production path to `published` is the editorial lifecycle in
 * `authoring-lifecycle.ts`: DRAFT -> SUBMITTED_FOR_REVIEW -> APPROVED, with a
 * four-eyes rule that requires an approver who is neither the author nor the
 * submitter. That workflow exists to make editorial responsibility attributable,
 * and driving it from a script with synthetic actors would record attribution
 * that means nothing while removing the only property it has.
 *
 * So this does what the repository's own regression fixtures do
 * (`scripts/regression/curriculumPhaseAHttpRegression.ts` among them): it sets
 * the resource statuses directly, on a local database, for a package that is
 * itself a draft carrying 535 open editorial approvals.
 *
 * WHAT IT DOES NOT SHORT-CIRCUIT: the curriculum version itself is published
 * through `publishCurriculumVersion`, the real domain command, so the whole
 * graph still passes the publish gate's validation. A structurally broken
 * package fails here exactly as it would anywhere else.
 *
 * Deliberately absent from the release scripts in package.json. Local only.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { publishCurriculumVersion } from "../../src/lib/curriculum/service";

const prisma = new PrismaClient();

function describe(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as Error).message);
  return String(error);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to run against a production environment");
  }

  const actor = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true } });
  if (!actor) throw new Error("no admin user — run `npm run prisma:seed` first");

  const version = await prisma.curriculumVersion.findFirst({
    where: { status: "draft" },
    orderBy: { id: "desc" },
    select: { id: true, code: true, versionNumber: true },
  });
  if (!version) throw new Error("no draft curriculum version — import a package first");

  console.log(`actor:   ${actor.email} (#${actor.id})`);
  console.log(`version: ${version.code} v${version.versionNumber} (#${version.id})`);

  const publishedAt = new Date();
  const scope = { curriculumVersionId: version.id, status: "draft" as const };

  const content = await prisma.contentVersion.updateMany({
    where: scope,
    data: { status: "published", publishedAt },
  });
  const assessments = await prisma.assessmentVersion.updateMany({
    where: scope,
    data: { status: "published", publishedAt },
  });
  const assignments = await prisma.reportAssignmentVersion.updateMany({
    where: scope,
    data: { status: "published", publishedAt },
  });
  // ReportRubricVersion hangs off the assignment, not the curriculum version,
  // so it is scoped through its bindings rather than by curriculumVersionId.
  const rubricIds = (
    await prisma.levelReportBinding.findMany({
      where: { curriculumVersionId: version.id },
      select: { reportRubricVersionId: true },
    })
  ).map((row) => row.reportRubricVersionId);
  const rubrics = await prisma.reportRubricVersion.updateMany({
    where: { id: { in: rubricIds }, status: "draft" },
    data: { status: "published", publishedAt },
  });

  console.log(
    `published: ${content.count} content, ${assessments.count} assessments, ` +
      `${rubrics.count} rubrics, ${assignments.count} report assignments`,
  );

  const result = await publishCurriculumVersion({ curriculumVersionId: version.id, actorId: actor.id });
  console.log("curriculum version published:", JSON.stringify(result).slice(0, 400));
}

main()
  .catch((error) => {
    console.error("FAILED:", describe(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

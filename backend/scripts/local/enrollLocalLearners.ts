/**
 * LOCAL DEVELOPMENT ONLY — enrol the seeded demo learners in the published
 * curriculum.
 *
 * Automatic enrolment on registration is gated behind
 * CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED, which the DEV flag policy
 * requires to stay off, so seeded accounts reach `kind: "candidate"` and stop
 * there. This runs the same operator command an administrator would, against
 * the demo accounts, so the Academy has a learner with a real programme to show.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { enrollUserInPublishedCurriculum } from "../../src/lib/curriculum/enrollment";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to run against a production environment");
  }

  const actor = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
  if (!actor) throw new Error("no admin user — run `npm run prisma:seed` first");

  const learners = await prisma.user.findMany({
    where: { email: { endsWith: "@test.com" } },
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });

  for (const learner of learners) {
    try {
      const result = await enrollUserInPublishedCurriculum({ userId: learner.id, actorId: actor.id });
      console.log(
        `${learner.email.padEnd(22)} ${result.created ? "enrolled" : "already enrolled"} ` +
          `(enrollment #${result.enrollment.id})`,
      );
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as Error).message) : String(error);
      console.log(`${learner.email.padEnd(22)} SKIPPED: ${message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

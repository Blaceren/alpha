import { PrismaClient } from "@prisma/client";
import { getTrainingLevelFromTasks } from "../../src/lib/trainingLevel";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function task(stepNumber: number, status: string) {
  return { stepNumber, progress: [{ status }] };
}

async function main() {
  assert(
    getTrainingLevelFromTasks([task(1, "active"), task(2, "locked")]) === 1,
    "lvl_01 active should produce training level 1",
  );
  assert(
    getTrainingLevelFromTasks([task(1, "completed"), task(2, "active"), task(3, "locked")]) === 2,
    "lvl_02 active should produce training level 2",
  );
  assert(
    getTrainingLevelFromTasks([task(1, "completed"), task(2, "completed"), task(3, "active")]) === 3,
    "lvl_03 active should produce training level 3",
  );
  assert(
    getTrainingLevelFromTasks([task(1, "completed"), task(2, "completed"), task(3, "completed"), task(4, "active")]) === 4,
    "lvl_04 active should produce training level 4",
  );

  const user = await prisma.user.findUnique({
    where: { email: "test-pocket-0706-1@gmail.com" },
    select: {
      email: true,
      level: true,
      xp: true,
      taskProgress: {
        select: { status: true, task: { select: { stepNumber: true, code: true } } },
        orderBy: { task: { stepNumber: "asc" } },
      },
      taskReports: {
        where: { id: 1 },
        select: { id: true, status: true },
      },
    },
  });

  assert(user, "test-pocket user should exist");
  const active = user.taskProgress.find((item) => item.status === "active");
  const trainingLevel = getTrainingLevelFromTasks(
    user.taskProgress.map((item) => ({
      stepNumber: item.task.stepNumber,
      progress: [{ status: item.status }],
    })),
  );

  assert(user.xp === 100, `expected XP 100, got ${user.xp}`);
  assert(user.level === 4, `expected stored level 4, got ${user.level}`);
  assert(trainingLevel === 4, `expected training level 4, got ${trainingLevel}`);
  assert(active?.task.code === "lvl_04_any_deposit", `expected lvl_04 active, got ${active?.task.code ?? "none"}`);
  assert(user.taskReports[0]?.status === "approved", `expected report #1 approved, got ${user.taskReports[0]?.status ?? "missing"}`);

  console.log(JSON.stringify({
    ok: true,
    helperCases: "passed",
    liveUser: {
      email: user.email,
      xp: user.xp,
      storedLevel: user.level,
      trainingLevel,
      activeTask: active?.task.code,
      report1Status: user.taskReports[0]?.status,
    },
  }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

/**
 * COMMUNITY-V1 — the access resolver, pinned.
 *
 * THE TEST THAT MATTERS MOST IS `does not read User.level`. Every learner in
 * PREPROD carries `User.level = 1` while two of them have completed fourteen V2
 * levels, so a Community gate that read the V1 column would refuse the learners
 * it exists to serve. The fixtures below reproduce exactly that divergence.
 */
import { describe, expect, it } from "vitest";
import { resolveCommunityAccess, findSpaceAccess } from "./access";

const MODULES = [
  { moduleNumber: 1, firstLevel: 1, lastLevel: 4 },
  { moduleNumber: 2, firstLevel: 5, lastLevel: 10 },
  { moduleNumber: 3, firstLevel: 11, lastLevel: 15 },
  { moduleNumber: 4, firstLevel: 16, lastLevel: 20 },
  { moduleNumber: 17, firstLevel: 81, lastLevel: 85 },
];

const SPACES = [
  { id: 1, code: "channel.start_questions", title: "Старт и вопросы", purpose: "p", readFromLevel: 0, writeFromLevel: 4, orderIndex: 1 },
  { id: 2, code: "channel.chart_review", title: "Разбор графиков", purpose: "p", readFromLevel: 20, writeFromLevel: 20, orderIndex: 2 },
  { id: 5, code: "channel.advanced_circle", title: "Продвинутый круг", purpose: "p", readFromLevel: 85, writeFromLevel: 85, orderIndex: 5 },
];

/**
 * A fake `db` carrying the two things the resolver reads, and NOTHING ELSE.
 *
 * This is itself an assertion: the object has no `user` delegate at all, so a
 * resolver that tried to read `User.level` could not even run against it.
 */
function fakeDb(options: {
  readonly completedLevels?: readonly number[];
  readonly currentLevel?: number;
  readonly enrolled?: boolean;
}) {
  const completed = options.completedLevels ?? [];
  return {
    communitySpace: {
      findMany: async () => SPACES,
    },
    userCurriculumEnrollment: {
      findFirst: async () =>
        options.enrolled === false
          ? null
          : {
              id: 1,
              curriculumVersionId: 4,
              levelProgress: completed.map((levelNumber) => ({
                status: "completed",
                levelDefinition: { levelNumber },
              })),
              curriculumVersion: { modules: MODULES },
            },
      findMany: async () => [],
    },
  } as never;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("Community access — the authority", () => {
  it("does not read User.level: a learner at V1 level 1 with 14 V2 levels gets level-14 access", async () => {
    // This is learner 73 in PREPROD: User.level 1, User.xp 0, V2 level 14 done.
    // The fake db exposes no user delegate, so the only progression this can
    // possibly have used is the durable V2 rows.
    const access = await resolveCommunityAccess(73, { db: fakeDb({ completedLevels: range(14) }) });

    expect(access.enrolled).toBe(true);
    expect(access.completedLevels).toBe(14);
    // Entry space: readable AND writable at 14, though V1 says level 1.
    const entry = findSpaceAccess(access, "channel.start_questions")!;
    expect(entry.canRead).toBe(true);
    expect(entry.canWrite).toBe(true);
    expect(entry.lockedReason).toBeNull();
  });

  it("uses durable level rows, never the summary counter", async () => {
    // A gap at level 4. Contiguous completion is 3, so the level-4 write gate
    // stays closed even though a counter reading "14" would open it.
    const withGap = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const access = await resolveCommunityAccess(1, { db: fakeDb({ completedLevels: withGap }) });

    expect(access.completedLevels).toBe(3);
    expect(findSpaceAccess(access, "channel.start_questions")!.canWrite).toBe(false);
  });

  it("opens reading of the entry space before writing, and says which is missing", async () => {
    const access = await resolveCommunityAccess(1, { db: fakeDb({ completedLevels: [1, 2] }) });
    const entry = findSpaceAccess(access, "channel.start_questions")!;

    expect(entry.canRead).toBe(true);
    expect(entry.canWrite).toBe(false);
    expect(entry.lockedReason).toBe("write_level_incomplete");
    // The requirement is expressed as a MODULE, which is what the learner reads.
    expect(entry.requiredModuleNumber).toBe(1);
  });

  it("keeps a later space closed for reading and names its module", async () => {
    const access = await resolveCommunityAccess(1, { db: fakeDb({ completedLevels: range(4) }) });
    const charts = findSpaceAccess(access, "channel.chart_review")!;

    expect(charts.canRead).toBe(false);
    expect(charts.canWrite).toBe(false);
    expect(charts.lockedReason).toBe("level_incomplete");
    expect(charts.requiredModuleNumber).toBe(4);
  });

  it("does not reveal a far-future space to an early learner", async () => {
    const access = await resolveCommunityAccess(1, { db: fakeDb({ completedLevels: range(4) }) });
    const advanced = findSpaceAccess(access, "channel.advanced_circle")!;
    expect(advanced.canRead).toBe(false);
    expect(advanced.requiredModuleNumber).toBe(17);
  });

  it("fails closed for a learner with no enrollment", async () => {
    const access = await resolveCommunityAccess(999, { db: fakeDb({ enrolled: false }) });
    expect(access.enrolled).toBe(false);
    expect(access.completedLevels).toBe(0);
    for (const space of access.spaces) {
      expect(space.canRead).toBe(false);
      expect(space.canWrite).toBe(false);
      expect(space.lockedReason).toBe("not_enrolled");
    }
  });

  it("a moderator reads every space and gains no write it did not earn", async () => {
    const access = await resolveCommunityAccess(54, {
      db: fakeDb({ completedLevels: [] }),
      moderatorReadsAll: true,
    });

    for (const space of access.spaces) {
      expect(space.canRead).toBe(true);
    }
    // Zero levels completed: the level-4 entry space is readable because they
    // moderate it, and NOT writable, because moderating is not progressing.
    expect(findSpaceAccess(access, "channel.start_questions")!.canWrite).toBe(false);
    expect(findSpaceAccess(access, "channel.advanced_circle")!.canWrite).toBe(false);
  });

  it("a moderator with no enrollment still reads and still cannot write", async () => {
    const access = await resolveCommunityAccess(54, {
      db: fakeDb({ enrolled: false }),
      moderatorReadsAll: true,
    });
    for (const space of access.spaces) {
      expect(space.canRead).toBe(true);
      expect(space.canWrite).toBe(false);
    }
  });
});

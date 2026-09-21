/**
 * TOOLS-V2 — News Calendar persistence: the learner's news plan, and the
 * published news items the calendar shows.
 *
 * THE PLAN IS APPEND-ONLY, as the Risk Plan is: a save adds a version, the
 * newest version is in force, and a save that says exactly what the newest
 * version says adds nothing. The read and the write share one transaction, so
 * two identical saves racing each other cannot both append.
 *
 * THE CALENDAR READS PUBLISHED ITEMS ONLY. A draft never reaches a learner.
 */
import type { NewsItem, PrismaClient, ToolNewsPlan } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { NEWS_CALENDAR_LIMITS, encodeCurrencies, isSameNewsPlan, type CalendarWindow, type NewsPlanInput } from "./news-calendar";

type Reader = Pick<PrismaClient, "toolNewsPlan">;
type Db = Pick<PrismaClient, "toolNewsPlan" | "$transaction">;

export type NewsPlanState = {
  /** The plan in force, or null before the first save. */
  readonly current: { readonly row: ToolNewsPlan; readonly version: number } | null;
};

const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

async function stateOf(userId: number, db: Reader): Promise<NewsPlanState> {
  const [total, newest] = await Promise.all([
    db.toolNewsPlan.count({ where: { userId } }),
    db.toolNewsPlan.findFirst({ where: { userId }, orderBy: NEWEST_FIRST }),
  ]);
  return { current: newest ? { row: newest, version: total } : null };
}

export function readNewsPlan(userId: number, db: Reader = defaultPrisma): Promise<NewsPlanState> {
  return stateOf(userId, db);
}

/** «Сохранить план»: a new version, unless the newest already says exactly this. */
export async function saveNewsPlan(
  userId: number,
  plan: NewsPlanInput,
  db: Db = defaultPrisma,
): Promise<{ readonly created: boolean; readonly state: NewsPlanState }> {
  return db.$transaction(async (tx) => {
    const newest = await tx.toolNewsPlan.findFirst({ where: { userId }, orderBy: NEWEST_FIRST });
    const created = !(newest && isSameNewsPlan(newest, plan));
    if (created) {
      await tx.toolNewsPlan.create({
        data: {
          userId,
          timeZone: plan.timeZone,
          minImportance: plan.minImportance,
          minutesBefore: plan.minutesBefore,
          minutesAfter: plan.minutesAfter,
          currencies: encodeCurrencies(plan.currencies),
        },
      });
    }
    return { created, state: await stateOf(userId, tx) };
  });
}

/** Published items released inside the window, earliest first. */
export function readCalendarEvents(
  window: CalendarWindow,
  db: Pick<PrismaClient, "newsItem"> = defaultPrisma,
): Promise<NewsItem[]> {
  return db.newsItem.findMany({
    where: { status: "published", releaseAt: { gte: window.from, lt: window.to } },
    orderBy: [{ releaseAt: "asc" }, { importance: "desc" }, { id: "asc" }],
    take: NEWS_CALENDAR_LIMITS.maxEvents,
  });
}

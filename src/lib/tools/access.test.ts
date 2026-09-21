import { describe, expect, it, vi } from "vitest";
import { isToolUnlockedForUser } from "./access";

function fakeDb(result: unknown) {
  const findFirst = vi.fn().mockResolvedValue(result);
  return { db: { userCurriculumEnrollment: { findFirst } } as never, findFirst };
}

describe("isToolUnlockedForUser", () => {
  it("opens the Trade Card when the L5 level is durably completed", async () => {
    const { db, findFirst } = fakeDb({ levelProgress: [{ id: 1 }] });
    await expect(isToolUnlockedForUser(7, "tool.trade_card", db)).resolves.toBe(true);

    const query = findFirst.mock.calls[0]![0];
    expect(query.where).toMatchObject({ userId: 7, status: { in: ["active", "completed"] } });
    expect(query.select.levelProgress.where).toEqual({
      status: "completed",
      levelDefinition: { levelNumber: 5 },
    });
  });

  it("stays locked without a completed row", async () => {
    const { db } = fakeDb({ levelProgress: [] });
    await expect(isToolUnlockedForUser(7, "tool.trade_card", db)).resolves.toBe(false);
  });

  it("stays locked without an enrollment", async () => {
    const { db } = fakeDb(null);
    await expect(isToolUnlockedForUser(7, "tool.trade_card", db)).resolves.toBe(false);
  });

  it("never opens an unknown or retired code, and does not even ask the database", async () => {
    const { db, findFirst } = fakeDb({ levelProgress: [{ id: 1 }] });
    await expect(isToolUnlockedForUser(7, "tool.chart_markup", db)).resolves.toBe(false);
    await expect(isToolUnlockedForUser(7, "tool.secret", db)).resolves.toBe(false);
    await expect(isToolUnlockedForUser(7, "tool.nope", db)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("asks for each tool's own level", async () => {
    const { db, findFirst } = fakeDb({ levelProgress: [] });
    await isToolUnlockedForUser(7, "tool.news_calendar", db);
    expect(findFirst.mock.calls[0]![0].select.levelProgress.where.levelDefinition).toEqual({ levelNumber: 30 });
  });
});

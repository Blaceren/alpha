/**
 * COMMUNITY-V1 — validation, the author projection, and the tombstone.
 *
 * The author projection tests are privacy tests. They are written against the
 * shape of what leaves the server, not against the implementation, so a future
 * refactor that starts spreading a Prisma row fails them.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  TITLE_MAX,
  canRemoveContent,
  normalizeBody,
  publicRoleLabel,
  toCommunityAuthor,
  toCommunityBody,
  validateBody,
  validateReportReason,
  validateTitle,
} from "./content";

describe("validation", () => {
  it("refuses an empty or whitespace-only submission", () => {
    expect(() => validateTitle("   ")).toThrow();
    expect(() => validateBody("\n\n\n")).toThrow();
    expect(() => validateBody("")).toThrow();
  });

  it("refuses a title that is too short to be a topic", () => {
    expect(() => validateTitle("ок")).toThrow();
    expect(validateTitle("как читать свечи")).toBe("как читать свечи");
  });

  it("bounds title and body", () => {
    expect(() => validateTitle("x".repeat(TITLE_MAX + 1))).toThrow();
    expect(() => validateBody("x".repeat(BODY_MAX + 1))).toThrow();
    expect(validateBody("x".repeat(BODY_MAX))).toHaveLength(BODY_MAX);
  });

  it("keeps paragraphs and collapses a shouting wall of blank lines", () => {
    expect(normalizeBody("первый\n\nвторой")).toBe("первый\n\nвторой");
    expect(normalizeBody("а\n\n\n\n\n\nб")).toBe("а\n\nб");
  });

  it("normalises a Windows paste so it compares equal to a Linux one", () => {
    expect(normalizeBody("а\r\nб")).toBe(normalizeBody("а\nб"));
  });

  it("accepts only the four report reasons", () => {
    for (const reason of ["spam", "off_topic", "abuse", "other"]) {
      expect(validateReportReason(reason)).toBe(reason);
    }
    expect(() => validateReportReason("scam")).toThrow();
    expect(() => validateReportReason("")).toThrow();
    expect(() => validateReportReason(7)).toThrow();
  });
});

describe("the author projection — what Community may say about a person", () => {
  const learner = { id: 42, name: "Артём" };

  it("carries a name, a module and nothing else", () => {
    const author = toCommunityAuthor(learner, { viewerId: 1, moduleNumber: 3 });
    expect(Object.keys(author).sort()).toEqual([
      "displayName",
      "id",
      "isViewer",
      "moduleNumber",
      "roleLabel",
    ]);
  });

  it("cannot leak a column that is not named — a spread would fail this", () => {
    const withSecrets = {
      ...learner,
      email: "artem@example.test",
      level: 17,
      xp: 4200,
      passwordHash: "$2b$secret",
      pocketPlayerId: "PKT-1",
      balance: 1200,
    } as never;
    const serialized = JSON.stringify(toCommunityAuthor(withSecrets, { viewerId: 1, moduleNumber: 3 }));

    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("4200");
    expect(serialized).not.toContain("$2b$");
    expect(serialized).not.toContain("PKT-1");
    expect(serialized).not.toContain("1200");
    // 17 was `level`. The module number is 3 and the id is 42, so no field
    // legitimately carries it.
    expect(serialized).not.toContain("17");
  });

  it("marks the viewer's own content so the UI can say so", () => {
    expect(toCommunityAuthor(learner, { viewerId: 42, moduleNumber: 1 }).isViewer).toBe(true);
    expect(toCommunityAuthor(learner, { viewerId: 43, moduleNumber: 1 }).isViewer).toBe(false);
  });
});

describe("public role labels", () => {
  it("publishes a coarse label for the three roles with public standing", () => {
    expect(publicRoleLabel("mentor")).toBe("Ментор");
    expect(publicRoleLabel("moderator")).toBe("Команда ATA");
    expect(publicRoleLabel("crm_admin")).toBe("Команда ATA");
  });

  it("publishes NOTHING for the internal roles", () => {
    // These roles exist and do operational work. Community is not the place a
    // learner discovers the company's internal structure.
    expect(publicRoleLabel("support")).toBeNull();
    expect(publicRoleLabel("analyst")).toBeNull();
    expect(publicRoleLabel("retention_manager")).toBeNull();
    expect(publicRoleLabel("content_manager")).toBeNull();
    expect(publicRoleLabel("read_only")).toBeNull();
    expect(publicRoleLabel("crm_manager")).toBeNull();
  });

  it("never emits the raw staff role name", () => {
    for (const role of ["mentor", "moderator", "crm_admin"] as const) {
      expect(publicRoleLabel(role)).not.toContain(role);
    }
  });

  it("gives a staff author no module number — staff are not on the learner path", () => {
    const author = toCommunityAuthor(
      { id: 69, name: "Наставник", staffProfile: { staffRole: "mentor" } },
      { viewerId: 1, moduleNumber: 9 },
    );
    expect(author.roleLabel).toBe("Ментор");
    expect(author.moduleNumber).toBeNull();
  });

  it("is null for an ordinary learner", () => {
    expect(toCommunityAuthor({ id: 1, name: "Л" }, { viewerId: 2, moduleNumber: 1 }).roleLabel).toBeNull();
  });
});

describe("the tombstone", () => {
  it("does not return the body of removed content", () => {
    const removed = toCommunityBody({ status: "removed_by_moderator", body: "исходный текст" });
    expect(JSON.stringify(removed)).not.toContain("исходный текст");
    expect(removed).toEqual({ kind: "removed", removedBy: "moderator" });
  });

  it("distinguishes a withdrawal from a removal", () => {
    expect(toCommunityBody({ status: "removed_by_author", body: "x" })).toEqual({
      kind: "removed",
      removedBy: "author",
    });
  });

  it("returns visible text unchanged", () => {
    expect(toCommunityBody({ status: "visible", body: "текст" })).toEqual({
      kind: "visible",
      text: "текст",
    });
  });
});

describe("removal authority", () => {
  it("lets an author remove their own content", () => {
    expect(canRemoveContent({ authorId: 5, viewerId: 5, viewerIsModerator: false })).toBe(true);
  });

  it("never lets a learner remove another learner's content", () => {
    expect(canRemoveContent({ authorId: 5, viewerId: 6, viewerIsModerator: false })).toBe(false);
  });

  it("lets a moderator remove content that is not theirs", () => {
    expect(canRemoveContent({ authorId: 5, viewerId: 6, viewerIsModerator: true })).toBe(true);
  });
});

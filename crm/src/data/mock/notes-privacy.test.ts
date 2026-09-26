/**
 * getUserNotes privacy (Phase 1B4-A). The read no longer ignores its context:
 * every note goes through the canonical projector before pagination.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import { MUTATION_OVERLAY_STORAGE_KEY, type MutationOverlay } from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { CrmNote } from "@/domain/notes/note";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();
const USER_ID = defaultDataset(clock)[0]!.identity.userId;

function ctx(role: CrmRole = "crm_admin", actorId = "emp_actor_1"): CrmContext {
  return { actorId, role, now: MOCK_NOW };
}

function note(over: Partial<CrmNote>): CrmNote {
  return {
    id: "note_seed",
    userId: USER_ID,
    caseId: null,
    authorEmployeeId: "emp_author",
    body: "Тело",
    visibility: "team",
    pinned: false,
    createdAt: "2026-07-13T09:00:00.001Z",
    updatedAt: "2026-07-13T09:00:00.001Z",
    mock: true,
    ...over,
  };
}

/** Seed a controlled overlay — the only way private/role_restricted notes exist. */
function withNotes(notes: CrmNote[]): MockCrmDataProvider {
  const overlay: MutationOverlay = {
    version: 1,
    sequence: notes.length,
    notes,
    auditRecords: [],
    idempotencyReceipts: [],
  };
  return new MockCrmDataProvider({
    clock,
    storage: new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify(overlay),
    }),
  });
}

async function notesFor(provider: MockCrmDataProvider, c: CrmContext) {
  const res = await provider.getUserNotes(c, { userId: USER_ID });
  return res;
}

describe("getUserNotes — context actually matters", () => {
  it("returns a different result for a different actor", async () => {
    const provider = withNotes([
      note({ id: "private_of_a", visibility: "private", authorEmployeeId: "emp_a" }),
    ]);

    const asAuthor = await notesFor(provider, ctx("crm_admin", "emp_a"));
    const asOther = await notesFor(provider, ctx("crm_admin", "emp_b"));

    expect(asAuthor.data?.items.map((n) => n.id)).toContain("private_of_a");
    expect(asOther.data?.items.map((n) => n.id)).not.toContain("private_of_a");
    expect(asAuthor.data?.items).not.toEqual(asOther.data?.items);
  });
});

describe("getUserNotes — team notes", () => {
  it("are visible to all nine roles, per the documented User 360 read right", async () => {
    const provider = withNotes([note({ id: "team_1", visibility: "team" })]);

    for (const role of CRM_ROLES) {
      const res = await notesFor(provider, ctx(role, "emp_nobody"));
      expect(res.data?.items.map((n) => n.id)).toContain("team_1");
    }
  });

  it("include the fixture-generated note", async () => {
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    const res = await notesFor(provider, ctx());

    expect(res.data?.items.map((n) => n.id)).toContain(`${USER_ID}_note_1`);
  });
});

describe("getUserNotes — private is fail-closed", () => {
  it("is hidden from every non-author role", async () => {
    const provider = withNotes([
      note({ id: "priv", visibility: "private", authorEmployeeId: "emp_author" }),
    ]);

    for (const role of CRM_ROLES) {
      const res = await notesFor(provider, ctx(role, "emp_not_the_author"));
      expect(res.data?.items.map((n) => n.id)).not.toContain("priv");
    }
  });

  it("is not widened to manager+ despite the contract's ambiguous comment", async () => {
    const provider = withNotes([
      note({ id: "priv", visibility: "private", authorEmployeeId: "emp_author" }),
    ]);

    for (const role of ["crm_admin", "crm_manager", "retention_manager"] as const) {
      const res = await notesFor(provider, ctx(role, "emp_manager"));
      expect(res.data?.items.map((n) => n.id)).not.toContain("priv");
    }
  });
});

describe("getUserNotes — role_restricted is fail-closed", () => {
  it("is hidden from every role, author included", async () => {
    const provider = withNotes([
      note({ id: "restricted", visibility: "role_restricted", authorEmployeeId: "emp_author" }),
    ]);

    for (const role of CRM_ROLES) {
      const res = await notesFor(provider, ctx(role, "emp_author"));
      expect(res.data?.items.map((n) => n.id)).not.toContain("restricted");
    }
  });
});

describe("getUserNotes — hidden notes do not exist for the caller", () => {
  it("are excluded from page.total, not merely from items", async () => {
    const provider = withNotes([
      note({ id: "team_1", visibility: "team" }),
      note({ id: "priv", visibility: "private", authorEmployeeId: "emp_someone" }),
      note({ id: "restricted", visibility: "role_restricted" }),
    ]);

    const res = await notesFor(provider, ctx("crm_admin", "emp_other"));

    // fixture note + team_1 only.
    expect(res.data?.page.total).toBe(2);
    expect(res.data?.items).toHaveLength(2);
  });

  it("counts one more for the author of the private note", async () => {
    const provider = withNotes([
      note({ id: "priv", visibility: "private", authorEmployeeId: "emp_author" }),
    ]);

    const asOther = await notesFor(provider, ctx("crm_admin", "emp_other"));
    const asAuthor = await notesFor(provider, ctx("crm_admin", "emp_author"));

    expect(asAuthor.data?.page.total).toBe((asOther.data?.page.total ?? 0) + 1);
  });

  it("never replaces a hidden note with a placeholder row", async () => {
    const provider = withNotes([
      note({ id: "priv", visibility: "private", authorEmployeeId: "emp_someone", body: "СКРЫТОЕ" }),
    ]);

    const res = await notesFor(provider, ctx("crm_admin", "emp_other"));
    const serialized = JSON.stringify(res);

    expect(serialized).not.toContain("priv");
    expect(serialized).not.toMatch(/скрыт/i);
    expect(serialized).not.toMatch(/недоступ/i);
    expect(serialized).not.toContain("СКРЫТОЕ");
  });

  it("does not leak a hidden body through the serialized Result", async () => {
    const provider = withNotes([
      note({
        id: "priv",
        visibility: "private",
        authorEmployeeId: "emp_someone",
        body: "СОВЕРШЕННО-СЕКРЕТНО",
      }),
      note({
        id: "restricted",
        visibility: "role_restricted",
        body: "ТОЖЕ-СЕКРЕТНО",
      }),
    ]);

    for (const role of CRM_ROLES) {
      const res = await notesFor(provider, ctx(role, "emp_other"));
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain("СОВЕРШЕННО-СЕКРЕТНО");
      expect(serialized).not.toContain("ТОЖЕ-СЕКРЕТНО");
    }
  });

  it("reports empty rather than pretending a role restriction when nothing is visible", async () => {
    const provider = withNotes([]);
    const res = await provider.getUserNotes(ctx(), { userId: "u_does_not_exist" });

    expect(res.status).toBe("empty");
    expect(res.error).toBeNull();
    expect(res.data?.items).toEqual([]);
  });
});

describe("getUserNotes — overlay notes are readable after addNote", () => {
  it("returns the note that was just added, exactly once", async () => {
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    const before = await notesFor(provider, ctx());

    await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Новая заметка",
      idempotencyKey: "k1",
    });
    const after = await notesFor(provider, ctx());

    const matches = after.data?.items.filter((n) => n.body === "Новая заметка") ?? [];
    expect(matches).toHaveLength(1);
    expect(after.data?.page.total).toBe((before.data?.page.total ?? 0) + 1);
  });

  it("does not duplicate the note when the mutation is replayed", async () => {
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Одна", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Одна", idempotencyKey: "k1" });

    const res = await notesFor(provider, ctx());
    expect(res.data?.items.filter((n) => n.body === "Одна")).toHaveLength(1);
  });

  it("is visible to the other roles too — a new note is a team note", async () => {
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    await provider.addNote(ctx("support", "emp_s1"), {
      userId: USER_ID,
      body: "От поддержки",
      idempotencyKey: "k1",
    });

    const asMentor = await notesFor(provider, ctx("mentor", "emp_m1"));
    expect(asMentor.data?.items.map((n) => n.body)).toContain("От поддержки");
  });

  it("keeps a note scoped to its own user", async () => {
    const other = defaultDataset(clock)[1]!.identity.userId;
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Только для первого", idempotencyKey: "k1" });

    const res = await provider.getUserNotes(ctx(), { userId: other });
    expect(res.data?.items.map((n) => n.body)).not.toContain("Только для первого");
  });
});

describe("getUserNotes — deterministic order", () => {
  it("returns the same order across repeated reads", async () => {
    const provider = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });

    const first = await notesFor(provider, ctx());
    const second = await notesFor(provider, ctx());

    expect(second.data?.items.map((n) => n.id)).toEqual(first.data?.items.map((n) => n.id));
  });

  it("puts pinned notes first, then the newest", async () => {
    const provider = withNotes([
      note({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" }),
      note({ id: "newest", createdAt: "2026-07-13T09:00:00.500Z" }),
      note({ id: "pinned_old", createdAt: "2020-01-01T00:00:00.000Z", pinned: true }),
    ]);

    const res = await notesFor(provider, ctx());
    const ids = res.data?.items.map((n) => n.id) ?? [];

    expect(ids[0]).toBe("pinned_old");
    expect(ids[1]).toBe("newest");
    expect(ids.indexOf("old")).toBeGreaterThan(ids.indexOf("newest"));
  });

  it("breaks ties by id when timestamps are identical", async () => {
    const same = "2026-07-13T09:00:00.001Z";
    const provider = withNotes([
      note({ id: "zzz", createdAt: same }),
      note({ id: "aaa", createdAt: same }),
    ]);

    const ids = (await notesFor(provider, ctx())).data?.items.map((n) => n.id) ?? [];
    expect(ids.indexOf("aaa")).toBeLessThan(ids.indexOf("zzz"));
  });
});

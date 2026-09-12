/**
 * deleteNote (Phase 1B6).
 *
 * Hard delete of an authored overlay note: the note row is physically removed, an
 * append-only `note_deleted` audit record is added on top of the note's earlier
 * records (which survive), no body is retained, and there is no undo. The check order
 * differs from the edit mutations in one load-bearing way — the idempotency replay is
 * resolved BEFORE the entity lookup, so a retry after the note has vanished replays
 * the original result instead of answering `not_found`. Covered here: validation
 * order, permissions across all 10 roles, the authored-only and author-only boundaries
 * (proven with DISTINCT actor ids, NOT the demo's shared `emp_mock_admin`), fixture
 * immutability, hidden-note indistinguishability, `expectedUpdatedAt` concurrency,
 * idempotency (replay after the note disappeared, replay id/timestamp stability,
 * cross-user/note/actor/role/kind conflicts), storage atomicity, the defensive
 * projection (a later valid `note_deleted` hides a stale row; a stale/corrupt record
 * does not), and the add-replay-after-delete rule (a replayed add never resurrects a
 * deleted note). Storage is always injected: no test touches a real localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  NOTE_DELETE_RECEIPT_KIND,
  NOTE_VISIBILITY_RECEIPT_KIND,
  parseOverlay,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { DeleteNoteCommand } from "@/data/contracts/CrmMutations";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();

const USER_ID = defaultDataset(clock)[0]!.identity.userId;
const OTHER_USER_ID = defaultDataset(clock)[1]!.identity.userId;
const FIXTURE_NOTE_ID = `${USER_ID}_note_1`;
const MISSING_USER_ID = "u_does_not_exist";

/** Two distinct real actors — authorship must be provable, not the demo's shared id. */
const AUTHOR = "emp_author_1";
const OTHER_ACTOR = "emp_other_2";

/** ROLE_PERMISSION_MATRIX §1 Edit → notes (D-53) — the SAME set that may addNote. */
const ALLOWED: readonly CrmRole[] = ["crm_admin", "crm_manager", "retention_manager", "support"];
const DENIED: readonly CrmRole[] = ["mentor", "moderator", "analyst", "content_manager", "read_only", "progression_operator"];

function ctx(role: CrmRole = "crm_admin", actorId = AUTHOR): CrmContext {
  return { actorId, role, now: MOCK_NOW };
}

function setup(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return { provider: new MockCrmDataProvider({ clock, storage }), storage };
}

function overlayIn(storage: KeyValueStorage) {
  return parseOverlay(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY));
}

/** Add an authored note and return its id + current updatedAt. */
async function addAuthoredNote(
  provider: MockCrmDataProvider,
  opts: {
    actorId?: string;
    role?: CrmRole;
    body?: string;
    key?: string;
    userId?: string;
    visibility?: "team" | "private";
  } = {},
): Promise<{ id: string; updatedAt: string }> {
  const res = await provider.addNote(ctx(opts.role ?? "crm_admin", opts.actorId ?? AUTHOR), {
    userId: opts.userId ?? USER_ID,
    body: opts.body ?? "Исходное тело заметки.",
    idempotencyKey: opts.key ?? "add-key",
  });
  const note = res.data!.note;
  if (opts.visibility === "private") {
    const vis = await provider.setNoteVisibility(ctx(opts.role ?? "crm_admin", opts.actorId ?? AUTHOR), {
      userId: opts.userId ?? USER_ID,
      noteId: note.id,
      visibility: "private",
      expectedUpdatedAt: note.updatedAt,
      idempotencyKey: `${opts.key ?? "add-key"}-vis`,
    });
    return { id: note.id, updatedAt: vis.data!.updatedAt };
  }
  return { id: note.id, updatedAt: note.updatedAt };
}

function cmd(overrides: Partial<DeleteNoteCommand> = {}): DeleteNoteCommand {
  return {
    userId: USER_ID,
    noteId: "note_mock_0001",
    expectedUpdatedAt: MOCK_NOW,
    idempotencyKey: "del-key",
    ...overrides,
  };
}

/** All note ids a user has, as seen by an actor. */
async function noteIds(provider: MockCrmDataProvider, actorId = AUTHOR, userId = USER_ID): Promise<string[]> {
  const notes = await provider.getUserNotes(ctx("crm_admin", actorId), { userId });
  return notes.data!.items.map((n) => n.id);
}

/* --------------------------------------------------------------- success */

describe("deleteNote — success", () => {
  it("deletes an OWN team note, removing the row and adding one fact-only audit record", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);

    const res = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    expect(res.status).toBe("ok");
    expect(res.data?.replayed).toBe(false);
    expect(res.data?.noteId).toBe(id);
    // One deletion timestamp: result.deletedAt === audit.at (D-98).
    expect(res.data!.audit.at).toBe(res.data!.deletedAt);

    const audit = res.data!.audit;
    expect(audit.action).toBe("note_deleted");
    if (audit.action === "note_deleted") {
      expect(audit.entityId).toBe(id);
      expect(audit.entityType).toBe("note");
      expect(audit.reasonCode).toBe("note_deleted_by_employee");
    }
    // The audit carries no body/visibility/pin payload — base fields only.
    expect(JSON.stringify(audit)).not.toContain("Исходное тело");

    // The note row is physically gone; the note is no longer visible.
    const overlay = overlayIn(storage);
    expect(overlay.notes.some((n) => n.id === id)).toBe(false);
    expect(await noteIds(provider)).not.toContain(id);
  });

  it("deletes an OWN private note by the same rules as a team note", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { visibility: "private" });

    const res = await provider.deleteNote(ctx("crm_admin", AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    expect(res.status).toBe("ok");
    expect(overlayIn(storage).notes.some((n) => n.id === id)).toBe(false);
  });

  it("shrinks page.total by exactly one", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const before = await provider.getUserNotes(ctx(), { userId: USER_ID });
    const totalBefore = before.data!.page.total!;

    await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    const after = await provider.getUserNotes(ctx(), { userId: USER_ID });
    expect(after.data!.page.total).toBe(totalBefore - 1);
  });
});

/* --------------------------------------------------------- entity boundaries */

describe("deleteNote — entity boundaries", () => {
  it("refuses the immutable fixture note with invalid_input, not not_found", async () => {
    const { provider } = setup();
    // The fixture note is visible and authored by the baseline owner, but it is not in
    // the overlay — it is generated. Deleting it is invalid_input (visibly present).
    const res = await provider.deleteNote(
      ctx("crm_admin", "emp_mock_admin"),
      cmd({ noteId: FIXTURE_NOTE_ID, expectedUpdatedAt: MOCK_NOW }),
    );
    expect(res.error?.code).toBe("invalid_input");
    // And it is still there.
    expect(await noteIds(provider, "emp_mock_admin")).toContain(FIXTURE_NOTE_ID);
  });

  it("refuses a foreign-authored VISIBLE (team) note with unauthorized", async () => {
    const { provider } = setup();
    // Authored by AUTHOR, team-visible to everyone. OTHER_ACTOR may see it but not delete it.
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    const res = await provider.deleteNote(ctx("crm_admin", OTHER_ACTOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    expect(res.error?.code).toBe("unauthorized");
  });

  it("returns not_found for a foreign PRIVATE note (hidden — no existence oracle)", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, visibility: "private" });
    // OTHER_ACTOR cannot see a private note authored by AUTHOR → not_found, exactly like
    // a note that does not exist. The mutation cannot probe for hidden notes.
    const res = await provider.deleteNote(ctx("crm_admin", OTHER_ACTOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    expect(res.error?.code).toBe("not_found");
  });

  it("returns not_found for an unknown note id", async () => {
    const { provider } = setup();
    const res = await provider.deleteNote(ctx(), cmd({ noteId: "note_mock_9999", expectedUpdatedAt: MOCK_NOW }));
    expect(res.error?.code).toBe("not_found");
  });

  it("returns not_found for an unknown user", async () => {
    const { provider } = setup();
    const res = await provider.deleteNote(ctx(), cmd({ userId: MISSING_USER_ID, noteId: "note_mock_0001" }));
    expect(res.error?.code).toBe("not_found");
  });
});

/* --------------------------------------------------------------- validation */

describe("deleteNote — validation", () => {
  it("rejects a missing idempotency key", async () => {
    const { provider } = setup();
    const res = await provider.deleteNote(ctx(), cmd({ idempotencyKey: "  " }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an over-long idempotency key", async () => {
    const { provider } = setup();
    const res = await provider.deleteNote(ctx(), cmd({ idempotencyKey: "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects a malformed expectedUpdatedAt before any lookup", async () => {
    const { provider } = setup();
    // Bad precondition answers identically for a known and an unknown user, so it never
    // reveals whether the user or note exists.
    const bad = await provider.deleteNote(ctx(), cmd({ expectedUpdatedAt: "not-a-date" }));
    expect(bad.error?.code).toBe("invalid_input");
    const badMissing = await provider.deleteNote(
      ctx(),
      cmd({ userId: MISSING_USER_ID, expectedUpdatedAt: "not-a-date" }),
    );
    expect(badMissing.error?.code).toBe("invalid_input");
  });

  it("rejects an empty note id", async () => {
    const { provider } = setup();
    const res = await provider.deleteNote(ctx(), cmd({ noteId: "   " }));
    expect(res.error?.code).toBe("invalid_input");
  });
});

/* --------------------------------------------------------------- concurrency */

describe("deleteNote — concurrency", () => {
  it("refuses a stale expectedUpdatedAt with conflict and leaves the overlay unchanged", async () => {
    const { provider, storage } = setup();
    const { id } = await addAuthoredNote(provider);
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    const res = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }));
    expect(res.error?.code).toBe("conflict");
    // Byte-for-byte unchanged: no delete, no audit, no receipt.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
    expect(await noteIds(provider)).toContain(id);
  });
});

/* -------------------------------------------------- permission across 9 roles */

describe("deleteNote — permission across all ten roles", () => {
  it("covers every CRM role exactly once", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  for (const role of ALLOWED) {
    it(`${role} may delete its OWN authored note`, async () => {
      const { provider } = setup();
      const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role });
      const res = await provider.deleteNote(ctx(role, AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
      expect(res.status).toBe("ok");
    });
  }

  for (const role of DENIED) {
    it(`${role} is unauthorized even for its own authored note`, async () => {
      // Seed as an allowed role (so the note exists, authored by AUTHOR), then attempt
      // the delete under a denied role with the SAME actor id — role change is NOT a
      // substitute for an actorEmployeeId change.
      const { provider } = setup();
      const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
      const res = await provider.deleteNote(ctx(role, AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
      expect(res.error?.code).toBe("unauthorized");
    });
  }
});

/* --------------------------------------------------------------- idempotency */

describe("deleteNote — idempotency", () => {
  it("replays after the note has disappeared, returning the same deletedAt/audit id and writing nothing new", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);

    const first = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "k1" }));
    expect(first.data?.replayed).toBe(false);

    const overlayAfterFirst = overlayIn(storage);
    const auditCount = overlayAfterFirst.auditRecords.length;
    const receiptCount = overlayAfterFirst.idempotencyReceipts.length;

    // Same key, same identity, note already gone. Replay MUST work despite the entity
    // vanishing — the replay is resolved before the entity lookup (D-98).
    const replay = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "k1" }));
    expect(replay.status).toBe("ok");
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.noteId).toBe(first.data?.noteId);
    expect(replay.data?.deletedAt).toBe(first.data?.deletedAt);
    expect(replay.data?.audit.id).toBe(first.data?.audit.id);

    // No second audit or receipt.
    const after = overlayIn(storage);
    expect(after.auditRecords.length).toBe(auditCount);
    expect(after.idempotencyReceipts.length).toBe(receiptCount);
  });

  it("replays even when expectedUpdatedAt differs on retry (it is not part of the fingerprint)", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const first = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "k2" }));

    const replay = await provider.deleteNote(
      ctx(),
      cmd({ noteId: id, expectedUpdatedAt: "2030-01-01T00:00:00.000Z", idempotencyKey: "k2" }),
    );
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.deletedAt).toBe(first.data?.deletedAt);
  });

  it("conflicts on the same key with a different userId / noteId / actorId / role", async () => {
    const { provider } = setup();
    const a = await addAuthoredNote(provider, { key: "na" });
    const b = await addAuthoredNote(provider, { key: "nb", userId: OTHER_USER_ID });
    await provider.deleteNote(ctx("crm_admin", AUTHOR), cmd({ noteId: a.id, expectedUpdatedAt: a.updatedAt, idempotencyKey: "shared" }));

    // Different note.
    const otherNote = await provider.deleteNote(
      ctx("crm_admin", AUTHOR),
      cmd({ noteId: b.id, userId: OTHER_USER_ID, expectedUpdatedAt: b.updatedAt, idempotencyKey: "shared" }),
    );
    expect(otherNote.error?.code).toBe("conflict");

    // Different user (same note id string but different user).
    const otherUser = await provider.deleteNote(
      ctx("crm_admin", AUTHOR),
      cmd({ noteId: a.id, userId: OTHER_USER_ID, expectedUpdatedAt: a.updatedAt, idempotencyKey: "shared" }),
    );
    expect(otherUser.error?.code).toBe("conflict");

    // Different actor.
    const otherActor = await provider.deleteNote(
      ctx("crm_admin", OTHER_ACTOR),
      cmd({ noteId: a.id, expectedUpdatedAt: a.updatedAt, idempotencyKey: "shared" }),
    );
    expect(otherActor.error?.code).toBe("conflict");

    // Different role.
    const otherRole = await provider.deleteNote(
      ctx("support", AUTHOR),
      cmd({ noteId: a.id, expectedUpdatedAt: a.updatedAt, idempotencyKey: "shared" }),
    );
    expect(otherRole.error?.code).toBe("conflict");
  });

  it("conflicts when the key was spent on a DIFFERENT mutation kind", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    // Spend the key on a visibility change first.
    await provider.setNoteVisibility(ctx(), {
      userId: USER_ID,
      noteId: id,
      visibility: "private",
      expectedUpdatedAt: updatedAt,
      idempotencyKey: "cross-kind",
    });
    // Re-use it for a delete → conflict (kind mismatch).
    const res = await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "cross-kind" }));
    expect(res.error?.code).toBe("conflict");
  });
});

/* -------------------------------------------------- persistence / atomicity */

describe("deleteNote — persistence & atomicity", () => {
  it("keeps the note on a storage failure and lets the SAME key retry", async () => {
    const storage = new MemoryKeyValueStorage();
    const { provider } = setup(storage);
    const { id, updatedAt } = await addAuthoredNote(provider);
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    let fail = true;
    const flakyStorage: KeyValueStorage = {
      getItem: (k) => storage.getItem(k),
      setItem: (k, v) => {
        if (fail) {
          fail = false;
          throw new Error("QuotaExceededError");
        }
        storage.setItem(k, v);
      },
      removeItem: (k) => storage.removeItem(k),
    };
    const flaky = new MockCrmDataProvider({ clock, storage: flakyStorage });

    const failed = await flaky.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "retry" }));
    expect(failed.error?.code).toBe("internal");
    // Nothing half-written: overlay byte-identical, note still present.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
    expect(await noteIds(flaky)).toContain(id);

    // Retry under the SAME key now succeeds — nothing was written the first time.
    const ok = await flaky.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "retry" }));
    expect(ok.status).toBe("ok");

    const reloaded = new MockCrmDataProvider({ clock, storage });
    expect(await noteIds(reloaded)).not.toContain(id);
  });

  it("keeps the note deleted across a fresh provider over the same storage", async () => {
    const storage = new MemoryKeyValueStorage();
    const { provider } = setup(storage);
    const { id, updatedAt } = await addAuthoredNote(provider);
    await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    const reloaded = new MockCrmDataProvider({ clock, storage });
    expect(await noteIds(reloaded)).not.toContain(id);
  });

  it("preserves the fixture note, every other note, and all prior audit records", async () => {
    const { provider, storage } = setup();
    const a = await addAuthoredNote(provider, { body: "Первая", key: "n1" });
    const second = await provider.addNote(ctx(), { userId: USER_ID, body: "Вторая", idempotencyKey: "n2" });
    const secondId = second.data!.note.id;
    // Pin the second note so it has a prior audit record that must survive.
    await provider.setNotePinned(ctx(), {
      userId: USER_ID,
      noteId: secondId,
      pinned: true,
      expectedPinned: false,
      idempotencyKey: "pin2",
    });
    const auditBefore = overlayIn(storage).auditRecords.length;

    await provider.deleteNote(ctx(), cmd({ noteId: a.id, expectedUpdatedAt: a.updatedAt }));

    const after = await provider.getUserNotes(ctx(), { userId: USER_ID });
    // The fixture note and the second authored note are both still present.
    expect(after.data!.items.some((n) => n.id === FIXTURE_NOTE_ID)).toBe(true);
    expect(after.data!.items.find((n) => n.id === secondId)?.pinned).toBe(true);
    // Prior audit records are not removed; the delete only appends one.
    const overlay = overlayIn(storage);
    expect(overlay.auditRecords.length).toBe(auditBefore + 1);
    // The deleted note's own note_added record survives (append-only log).
    expect(overlay.auditRecords.some((r) => r.action === "note_added" && r.entityId === a.id)).toBe(true);
    expect(overlay.auditRecords.some((r) => r.action === "note_deleted" && r.entityId === a.id)).toBe(true);
  });

  it("stores exactly one delete receipt, never a visibility one", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    const kinds = overlayIn(storage).idempotencyReceipts.map((r) => r.kind);
    expect(kinds).toContain(NOTE_DELETE_RECEIPT_KIND);
    expect(kinds).not.toContain(NOTE_VISIBILITY_RECEIPT_KIND);
  });
});

/* -------------------------------------------------- defensive projection */

describe("deleteNote — defensive projection (audit is the source of truth)", () => {
  it("hides a stale note row when a later valid note_deleted record exists", async () => {
    // A corrupt/legacy overlay: the note row survived, but a later note_deleted names
    // it. The projector must present it as gone (D-97).
    const storage = new MemoryKeyValueStorage();
    const noteAt = "2026-07-13T09:00:00.001Z";
    const deleteAt = "2026-07-13T10:00:00.000Z"; // later than the note
    storage.setItem(
      MUTATION_OVERLAY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sequence: 5,
        notes: [
          {
            id: "note_mock_0001",
            userId: USER_ID,
            caseId: null,
            authorEmployeeId: AUTHOR,
            body: "Осталась в overlay по ошибке",
            visibility: "team",
            pinned: false,
            createdAt: noteAt,
            updatedAt: noteAt,
            mock: true,
          },
        ],
        auditRecords: [
          {
            id: "audit_mock_0005",
            action: "note_deleted",
            actorEmployeeId: AUTHOR,
            actorRole: "crm_admin",
            targetUserId: USER_ID,
            entityType: "note",
            entityId: "note_mock_0001",
            at: deleteAt,
            reasonCode: "note_deleted_by_employee",
            mock: true,
          },
        ],
        idempotencyReceipts: [],
      }),
    );
    const provider = new MockCrmDataProvider({ clock, storage });
    expect(await noteIds(provider)).not.toContain("note_mock_0001");
  });

  it("does NOT hide a note when the note_deleted record predates the note's updatedAt (stale/corrupt record)", async () => {
    const storage = new MemoryKeyValueStorage();
    const deleteAt = "2026-07-13T09:00:00.000Z";
    const noteAt = "2026-07-13T10:00:00.000Z"; // note written AFTER the delete claim
    storage.setItem(
      MUTATION_OVERLAY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sequence: 5,
        notes: [
          {
            id: "note_mock_0001",
            userId: USER_ID,
            caseId: null,
            authorEmployeeId: AUTHOR,
            body: "Живая заметка",
            visibility: "team",
            pinned: false,
            createdAt: noteAt,
            updatedAt: noteAt,
            mock: true,
          },
        ],
        auditRecords: [
          {
            id: "audit_mock_0005",
            action: "note_deleted",
            actorEmployeeId: AUTHOR,
            actorRole: "crm_admin",
            targetUserId: USER_ID,
            entityType: "note",
            entityId: "note_mock_0001",
            at: deleteAt,
            reasonCode: "note_deleted_by_employee",
            mock: true,
          },
        ],
        idempotencyReceipts: [],
      }),
    );
    const provider = new MockCrmDataProvider({ clock, storage });
    expect(await noteIds(provider)).toContain("note_mock_0001");
  });

  it("a structurally corrupt note_deleted record fails the overlay parse closed (empty overlay)", async () => {
    const storage = new MemoryKeyValueStorage();
    storage.setItem(
      MUTATION_OVERLAY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sequence: 5,
        notes: [],
        auditRecords: [
          {
            id: "audit_mock_0005",
            action: "note_deleted",
            actorEmployeeId: AUTHOR,
            actorRole: "crm_admin",
            targetUserId: USER_ID,
            entityType: "user", // WRONG — a note_deleted must have entityType "note"
            entityId: "note_mock_0001",
            at: MOCK_NOW,
            reasonCode: "note_deleted_by_employee",
            mock: true,
          },
        ],
        idempotencyReceipts: [],
      }),
    );
    // The whole overlay degrades to empty (fail closed), so the fixture note is the
    // only note and it is NOT hidden — a corrupt delete record can hide nothing.
    const provider = new MockCrmDataProvider({ clock, storage });
    expect(await noteIds(provider, "emp_mock_admin")).toEqual([FIXTURE_NOTE_ID]);
  });

  it("a fixture note cannot be hidden through the normal mutation path", async () => {
    const { provider } = setup();
    // Attempt to delete the fixture note → invalid_input, no note_deleted written.
    await provider.deleteNote(
      ctx("crm_admin", "emp_mock_admin"),
      cmd({ noteId: FIXTURE_NOTE_ID, expectedUpdatedAt: MOCK_NOW }),
    );
    expect(await noteIds(provider, "emp_mock_admin")).toContain(FIXTURE_NOTE_ID);
  });
});

/* -------------------------------------------------- add replay after delete */

describe("deleteNote — add replay after delete never resurrects the note", () => {
  it("replays the original addNote key after a delete without writing the note back", async () => {
    const { provider, storage } = setup();
    // 1. add
    const add = await provider.addNote(ctx(), { userId: USER_ID, body: "Тело заметки", idempotencyKey: "add-1" });
    const id = add.data!.note.id;
    const updatedAt = add.data!.note.updatedAt;

    // 2. delete
    await provider.deleteNote(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "del-1" }));
    expect(await noteIds(provider)).not.toContain(id);

    // 3. retry the ORIGINAL addNote key with the same payload.
    const replay = await provider.addNote(ctx(), { userId: USER_ID, body: "Тело заметки", idempotencyKey: "add-1" });
    expect(replay.status).toBe("ok");
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.note.id).toBe(id);

    // The note is NOT resurrected — still gone from the overlay and the read.
    expect(overlayIn(storage).notes.some((n) => n.id === id)).toBe(false);
    expect(await noteIds(provider)).not.toContain(id);

    // Audit has exactly one note_added and one note_deleted for this note.
    const records = overlayIn(storage).auditRecords.filter((r) => r.entityId === id);
    expect(records.filter((r) => r.action === "note_added")).toHaveLength(1);
    expect(records.filter((r) => r.action === "note_deleted")).toHaveLength(1);
  });
});

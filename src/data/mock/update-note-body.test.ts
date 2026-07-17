/**
 * updateNoteBody (Phase 1B4-E).
 *
 * Validation/security order, permissions across all 9 roles, the authored-only and
 * author-only boundaries (proven with DISTINCT actor ids, not the demo's shared
 * `emp_mock_admin`), fixture immutability, hidden-note indistinguishability,
 * `expectedUpdatedAt` concurrency, idempotency (replay, replay-after-a-later-edit,
 * fingerprint conflict, cross-command receipt collisions), storage atomicity, the
 * fact that the audit and receipt carry NO body, and read-consistency (new body,
 * preserved pin/order/total). Storage is always injected: no test touches a real
 * localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  NOTE_BODY_RECEIPT_KIND,
  NOTE_PIN_RECEIPT_KIND,
  PRIMARY_OWNER_RECEIPT_KIND,
  parseOverlay,
  type MutationOverlay,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { PRIMARY_OWNER_CANDIDATES } from "@/domain/identity/employees";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();

const USER_ID = defaultDataset(clock)[0]!.identity.userId;
const OTHER_USER_ID = defaultDataset(clock)[1]!.identity.userId;
/** The fixture user's baseline primary owner and a distinct valid candidate. */
const BASELINE_OWNER = defaultDataset(clock)[0]!.operations.primaryOwnerId;
const OWNER_CANDIDATE = PRIMARY_OWNER_CANDIDATES.find((e) => e.employeeId !== BASELINE_OWNER)!.employeeId;
/** The seeded fixture note the provider synthesises for every user. */
const FIXTURE_NOTE_ID = `${USER_ID}_note_1`;
const MISSING_USER_ID = "u_does_not_exist";

/** Two distinct real actors — the demo shares one, but authorship must be provable. */
const AUTHOR = "emp_author_1";
const OTHER_ACTOR = "emp_other_2";

/** ROLE_PERMISSION_MATRIX §1 Edit → notes (D-53) — the SAME set that may addNote. */
const ALLOWED: readonly CrmRole[] = ["crm_admin", "crm_manager", "retention_manager", "support"];
const DENIED: readonly CrmRole[] = ["mentor", "moderator", "analyst", "content_manager", "read_only"];

function ctx(role: CrmRole = "crm_admin", actorId = AUTHOR): CrmContext {
  return { actorId, role, now: MOCK_NOW };
}

function setup(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return { provider: new MockCrmDataProvider({ clock, storage }), storage };
}

function overlayIn(storage: KeyValueStorage) {
  return parseOverlay(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY));
}

/** Add an authored note and return its id + current updatedAt, authored by `actorId`. */
async function addAuthoredNote(
  provider: MockCrmDataProvider,
  opts: { actorId?: string; role?: CrmRole; body?: string; key?: string; userId?: string } = {},
): Promise<{ id: string; updatedAt: string }> {
  const res = await provider.addNote(ctx(opts.role ?? "crm_admin", opts.actorId ?? AUTHOR), {
    userId: opts.userId ?? USER_ID,
    body: opts.body ?? "Исходное тело заметки.",
    idempotencyKey: opts.key ?? "add-key",
  });
  const note = res.data!.note;
  return { id: note.id, updatedAt: note.updatedAt };
}

function edit(overrides: Partial<Parameters<MockCrmDataProvider["updateNoteBody"]>[1]> = {}) {
  return {
    userId: USER_ID,
    noteId: "note_mock_0001",
    body: "Обновлённое тело заметки.",
    expectedUpdatedAt: MOCK_NOW,
    idempotencyKey: "edit-key",
    ...overrides,
  };
}

async function bodyOf(provider: MockCrmDataProvider, noteId: string, actorId = AUTHOR): Promise<string | undefined> {
  const notes = await provider.getUserNotes(ctx("crm_admin", actorId), { userId: USER_ID });
  return notes.data!.items.find((n) => n.id === noteId)?.body;
}

/** A storage whose reads work but every write throws — for atomicity tests. */
function failingWrite(backing: KeyValueStorage): KeyValueStorage {
  return {
    getItem: (k) => backing.getItem(k),
    setItem: () => {
      throw new Error("storage disabled");
    },
    removeItem: (k) => backing.removeItem(k),
  };
}

/* --------------------------------------------------------------- happy path */

describe("updateNoteBody — successful own-authored edit", () => {
  it("rewrites the body, advances updatedAt, and shares one timestamp with the audit", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);

    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt }));

    expect(res.status).toBe("ok");
    expect(res.data?.noteId).toBe(id);
    expect(res.data?.replayed).toBe(false);
    // The result carries NO note and NO body — only id + timestamp + audit.
    expect(res.data).not.toHaveProperty("note");
    expect(res.data && Object.keys(res.data).sort()).toEqual(["audit", "noteId", "replayed", "updatedAt"]);
    // One mutation timestamp: the note's new updatedAt IS the audit's `at`.
    expect(res.data?.updatedAt).toBe(res.data?.audit.at);
    expect(res.data?.updatedAt).not.toBe(updatedAt);

    // The read now returns the new body.
    expect(await bodyOf(provider, id)).toBe("Обновлённое тело заметки.");

    // The stored note kept its identity; only body + updatedAt changed.
    const stored = overlayIn(storage).notes.find((n) => n.id === id)!;
    expect(stored.body).toBe("Обновлённое тело заметки.");
    expect(stored.updatedAt).toBe(res.data?.updatedAt);
    expect(stored.authorEmployeeId).toBe(AUTHOR);
    expect(stored.visibility).toBe("team");
    expect(stored.pinned).toBe(false);
  });

  it("preserves id, createdAt and authorEmployeeId across the edit", async () => {
    const { provider, storage } = setup();
    const { id } = await addAuthoredNote(provider);
    const before = overlayIn(storage).notes.find((n) => n.id === id)!;

    await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: before.updatedAt }));

    const after = overlayIn(storage).notes.find((n) => n.id === id)!;
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.authorEmployeeId).toBe(before.authorEmployeeId);
  });
});

/* --------------------------------------------------------------- permissions */

describe("updateNoteBody — permissions across all nine roles", () => {
  it.each(ALLOWED)("%s may edit its OWN authored note", async (role) => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { role, actorId: AUTHOR });
    const res = await provider.updateNoteBody(ctx(role, AUTHOR), edit({ noteId: id, expectedUpdatedAt: updatedAt }));
    expect(res.status).toBe("ok");
    expect(res.error).toBeNull();
  });

  it.each(DENIED)("%s may not edit — unauthorized, nothing written", async (role) => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    const res = await provider.updateNoteBody(ctx(role, AUTHOR), edit({ noteId: id, expectedUpdatedAt: updatedAt }));

    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("unauthorized");
    // No audit, no receipt, no body rewrite.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
  });
});

/* ------------------------------------------------------ author-only boundary */

describe("updateNoteBody — only the author may edit (distinct actor ids)", () => {
  it("another actor cannot edit a VISIBLE (team) authored note — unauthorized", async () => {
    const { provider, storage } = setup();
    // Author writes a team note (visible to everyone).
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    // A DIFFERENT employee, holding a permitted role, tries to rewrite it.
    const res = await provider.updateNoteBody(
      ctx("crm_admin", OTHER_ACTOR),
      edit({ noteId: id, expectedUpdatedAt: updatedAt }),
    );

    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("unauthorized");
    // The note is untouched.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
    expect(await bodyOf(provider, id)).toBe("Исходное тело заметки.");
  });

  it("a permitted role editing another actor's note is unauthorized even though it may edit its own", async () => {
    const { provider } = setup();
    const author = await addAuthoredNote(provider, { actorId: AUTHOR, key: "a" });
    const mine = await addAuthoredNote(provider, { actorId: OTHER_ACTOR, key: "b" });

    // OTHER_ACTOR may edit its own note...
    const own = await provider.updateNoteBody(
      ctx("crm_admin", OTHER_ACTOR),
      edit({ noteId: mine.id, expectedUpdatedAt: mine.updatedAt, idempotencyKey: "own" }),
    );
    expect(own.status).toBe("ok");

    // ...but not AUTHOR's note.
    const foreign = await provider.updateNoteBody(
      ctx("crm_admin", OTHER_ACTOR),
      edit({ noteId: author.id, expectedUpdatedAt: author.updatedAt, idempotencyKey: "foreign" }),
    );
    expect(foreign.error?.code).toBe("unauthorized");
  });
});

/* ---------------------------------------------------------- fixture immutable */

describe("updateNoteBody — the fixture note is immutable", () => {
  it("editing the fixture note is invalid_input, NOT not_found (it is visibly present)", async () => {
    const { provider, storage } = setup();
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: FIXTURE_NOTE_ID, expectedUpdatedAt: MOCK_NOW }),
    );

    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("invalid_input");
    // Nothing was written, and the fixture note remains byte-identical on re-read.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
    const notes = await provider.getUserNotes(ctx(), { userId: USER_ID });
    const fixture = notes.data!.items.find((n) => n.id === FIXTURE_NOTE_ID)!;
    expect(fixture.body).toContain("Синтетическая заметка");
  });
});

/* --------------------------------------------------------- hidden-note safety */

describe("updateNoteBody — hidden and nonexistent notes are indistinguishable", () => {
  /** Seed a private note authored by someone else, so the caller cannot see it. */
  function seedHiddenPrivateNote(): KeyValueStorage {
    const overlay: MutationOverlay = {
      version: 1,
      sequence: 1,
      notes: [
        {
          id: "note_mock_0001",
          userId: USER_ID,
          caseId: null,
          authorEmployeeId: OTHER_ACTOR,
          body: "СКРЫТОЕ-ТЕЛО",
          visibility: "private",
          pinned: false,
          createdAt: MOCK_NOW,
          updatedAt: MOCK_NOW,
          mock: true,
        },
      ],
      auditRecords: [],
      idempotencyReceipts: [],
    };
    return new MemoryKeyValueStorage({ [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify(overlay) });
  }

  it("a note hidden from the caller returns not_found", async () => {
    const { provider } = setup(seedHiddenPrivateNote());
    const res = await provider.updateNoteBody(
      ctx("crm_admin", AUTHOR), // not the author of the private note
      edit({ noteId: "note_mock_0001", expectedUpdatedAt: MOCK_NOW }),
    );
    expect(res.error?.code).toBe("not_found");
  });

  it("a note that does not exist returns the SAME not_found", async () => {
    const { provider } = setup(seedHiddenPrivateNote());
    const res = await provider.updateNoteBody(
      ctx("crm_admin", AUTHOR),
      edit({ noteId: "note_mock_9999", expectedUpdatedAt: MOCK_NOW }),
    );
    expect(res.error?.code).toBe("not_found");
  });

  it("an unknown user returns not_found", async () => {
    const { provider } = setup();
    const res = await provider.updateNoteBody(ctx(), edit({ userId: MISSING_USER_ID }));
    expect(res.error?.code).toBe("not_found");
  });
});

/* ------------------------------------------------------------- body validation */

describe("updateNoteBody — body validation, no write", () => {
  async function expectInvalid(body: string, expectedUpdatedAt?: string) {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);
    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body, expectedUpdatedAt: expectedUpdatedAt ?? updatedAt }),
    );
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("invalid_input");
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
    return res;
  }

  it("rejects an empty body", async () => {
    await expectInvalid("");
  });

  it("rejects a whitespace-only body", async () => {
    await expectInvalid("   \n\t  ");
  });

  it("rejects an over-long body", async () => {
    await expectInvalid("я".repeat(NOTE_BODY_MAX_LENGTH + 1));
  });

  it("rejects a normalized body equal to the stored body (no change) and writes no audit", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { body: "То же самое" });
    const auditsBefore = overlayIn(storage).auditRecords.length;

    // Different whitespace, same normalized text.
    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "   То же самое   ", expectedUpdatedAt: updatedAt }),
    );

    expect(res.error?.code).toBe("invalid_input");
    expect(overlayIn(storage).auditRecords.length).toBe(auditsBefore);
  });

  it("never carries the body in the error message", async () => {
    const res = await expectInvalid("");
    expect(res.error?.message ?? "").not.toContain("Обновлённое");
  });
});

/* -------------------------------------------------------------- key validation */

describe("updateNoteBody — idempotency key validation", () => {
  it("rejects a missing key", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "  " }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an over-long key", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });
});

/* -------------------------------------------------- expectedUpdatedAt handling */

describe("updateNoteBody — expectedUpdatedAt precondition", () => {
  it("rejects a malformed expectedUpdatedAt with invalid_input", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider);
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: "not-a-date" }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an empty expectedUpdatedAt with invalid_input", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider);
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: "" }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("conflicts when the stored updatedAt no longer matches", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    // First edit advances updatedAt.
    await provider.updateNoteBody(ctx(), edit({ noteId: id, body: "Первое", expectedUpdatedAt: updatedAt, idempotencyKey: "k1" }));
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    // Second edit still believes the ORIGINAL updatedAt — stale precondition.
    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Второе", expectedUpdatedAt: updatedAt, idempotencyKey: "k2" }),
    );

    expect(res.error?.code).toBe("conflict");
    // A conflict writes nothing.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
  });
});

/* -------------------------------------------------------------- idempotency */

describe("updateNoteBody — idempotency and replay", () => {
  it("replays the ORIGINAL result on the same key + same command", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const first = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Один", expectedUpdatedAt: updatedAt, idempotencyKey: "same" }),
    );
    const auditsAfterFirst = overlayIn(storage).auditRecords.length;

    // Same key, same normalized command — even with the now-stale original updatedAt.
    const replay = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Один", expectedUpdatedAt: updatedAt, idempotencyKey: "same" }),
    );

    expect(replay.status).toBe("ok");
    expect(replay.data?.replayed).toBe(true);
    // Original metadata, reconstructed from the audit alone.
    expect(replay.data?.noteId).toBe(first.data?.noteId);
    expect(replay.data?.updatedAt).toBe(first.data?.updatedAt);
    // No second audit record was written.
    expect(overlayIn(storage).auditRecords.length).toBe(auditsAfterFirst);
  });

  it("replays key A even after a LATER edit under key B moved the note on", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);

    // 1. edit with key A → "Alpha"
    const a = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Alpha", expectedUpdatedAt: updatedAt, idempotencyKey: "A" }),
    );
    // 2. edit the same note again with key B → "Beta"
    await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Beta", expectedUpdatedAt: a.data!.updatedAt, idempotencyKey: "B" }),
    );

    // 3. replay key A.
    const replay = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Alpha", expectedUpdatedAt: updatedAt, idempotencyKey: "A" }),
    );

    // 4-6. returns A's ORIGINAL metadata, claims no body, and the note stays "Beta".
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.updatedAt).toBe(a.data?.updatedAt);
    expect(replay.data).not.toHaveProperty("note");
    expect(await bodyOf(provider, id)).toBe("Beta");
  });

  it("conflicts when the key was reused for a DIFFERENT body on the same note", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    await provider.updateNoteBody(ctx(), edit({ noteId: id, body: "Один", expectedUpdatedAt: updatedAt, idempotencyKey: "reuse" }));
    // The note advanced; use its new updatedAt for a legitimate precondition.
    const now = (await provider.getUserNotes(ctx(), { userId: USER_ID })).data!.items.find((n) => n.id === id)!.updatedAt;

    const res = await provider.updateNoteBody(
      ctx(),
      edit({ noteId: id, body: "Совсем другое", expectedUpdatedAt: now, idempotencyKey: "reuse" }),
    );
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the same key is reused for a different USER", async () => {
    const { provider } = setup();
    const here = await addAuthoredNote(provider, { key: "n1", userId: USER_ID });
    const there = await addAuthoredNote(provider, { key: "n2", userId: OTHER_USER_ID });

    await provider.updateNoteBody(ctx(), edit({ userId: USER_ID, noteId: here.id, expectedUpdatedAt: here.updatedAt, idempotencyKey: "shared" }));
    const res = await provider.updateNoteBody(ctx(), edit({ userId: OTHER_USER_ID, noteId: there.id, expectedUpdatedAt: there.updatedAt, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the same key is reused for a different NOTE", async () => {
    const { provider } = setup();
    const a = await addAuthoredNote(provider, { key: "n1", body: "Первая" });
    const b = await addAuthoredNote(provider, { key: "n2", body: "Вторая" });

    await provider.updateNoteBody(ctx(), edit({ noteId: a.id, expectedUpdatedAt: a.updatedAt, idempotencyKey: "shared" }));
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: b.id, expectedUpdatedAt: b.updatedAt, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the same key is reused under a different ROLE (fingerprint includes role)", async () => {
    const { provider } = setup();
    // AUTHOR authors the note, so authorship passes under either role and the
    // idempotency check is actually reached.
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    await provider.updateNoteBody(ctx("crm_admin", AUTHOR), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "shared" }));
    const now = (await provider.getUserNotes(ctx("crm_admin", AUTHOR), { userId: USER_ID })).data!.items.find((n) => n.id === id)!.updatedAt;

    const res = await provider.updateNoteBody(ctx("crm_manager", AUTHOR), edit({ noteId: id, expectedUpdatedAt: now, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the key belongs to an addNote receipt", async () => {
    const { provider } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "x", idempotencyKey: "shared" });
    const { id, updatedAt } = await addAuthoredNote(provider, { key: "other" });
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the key belongs to a pin receipt", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { key: "add" });
    await provider.setNotePinned(ctx(), { userId: USER_ID, noteId: id, pinned: true, expectedPinned: false, idempotencyKey: "shared" });
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("conflicts when the key belongs to an owner-change receipt", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { key: "add" });
    const owner = await provider.assignPrimaryOwner(ctx(), {
      userId: USER_ID,
      ownerId: OWNER_CANDIDATE,
      expectedOwnerId: BASELINE_OWNER,
      idempotencyKey: "shared",
    });
    expect(owner.status).toBe("ok"); // the receipt really was created under "shared"
    const res = await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });
});

/* ------------------------------------------------------------ storage atomicity */

describe("updateNoteBody — storage failure is atomic and does not consume the key", () => {
  it("returns internal (retriable), writes nothing, and the same key still works after recovery", async () => {
    const backing = new MemoryKeyValueStorage();
    const good = setup(backing);
    const { id, updatedAt } = await addAuthoredNote(good.provider);
    const snapshot = backing.getItem(MUTATION_OVERLAY_STORAGE_KEY);

    // Same backing store, but writes throw.
    const broken = new MockCrmDataProvider({ clock, storage: failingWrite(backing) });
    const failed = await broken.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "K" }));

    expect(failed.error?.code).toBe("internal");
    expect(failed.error?.retriable).toBe(true);
    // Nothing persisted — no receipt, no audit, no rewrite.
    expect(backing.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(snapshot);

    // The key was NOT consumed: retrying the same command on working storage succeeds
    // as a fresh write (not a replay).
    const retry = await good.provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "K" }));
    expect(retry.status).toBe("ok");
    expect(retry.data?.replayed).toBe(false);
  });
});

/* --------------------------------------------------------------- audit safety */

describe("updateNoteBody — audit and receipt carry no body", () => {
  it("writes a note_body_changed audit with base fields only and no body anywhere", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const SECRET = "СЕКРЕТНОЕ-ТЕЛО-ЗАМЕТКИ";

    await provider.updateNoteBody(ctx(), edit({ noteId: id, body: SECRET, expectedUpdatedAt: updatedAt, idempotencyKey: "K" }));

    const overlay = overlayIn(storage);
    const audit = overlay.auditRecords.find((a) => a.action === "note_body_changed")!;
    expect(audit).toBeDefined();
    expect(Object.keys(audit).sort()).toEqual(
      ["action", "actorEmployeeId", "actorRole", "at", "entityId", "entityType", "id", "mock", "reasonCode", "targetUserId"].sort(),
    );
    expect(audit.entityId).toBe(id);
    expect(audit.reasonCode).toBe("note_body_changed_by_employee");
    // The body is nowhere in the audit record.
    expect(JSON.stringify(audit)).not.toContain(SECRET);

    // The receipt holds only kind/key/fingerprint/auditId — no body, no note id.
    const receipt = overlay.idempotencyReceipts.find((r) => r.key === "K")!;
    expect(receipt.kind).toBe(NOTE_BODY_RECEIPT_KIND);
    expect(Object.keys(receipt).sort()).toEqual(["auditId", "fingerprint", "key", "kind"].sort());
    expect(JSON.stringify(receipt)).not.toContain(SECRET);
    // The fingerprint is a hex digest, not the text.
    expect(receipt.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ------------------------------------------------------------ read consistency */

describe("updateNoteBody — read consistency and preservation", () => {
  it("keeps pin state and pinned-first order after a body edit", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    // Pin the fixture note so ordering is observable.
    await provider.setNotePinned(ctx(), { userId: USER_ID, noteId: FIXTURE_NOTE_ID, pinned: true, expectedPinned: false, idempotencyKey: "pin" });

    const before = await provider.getUserNotes(ctx(), { userId: USER_ID });
    expect(before.data!.items[0]!.id).toBe(FIXTURE_NOTE_ID); // pinned first

    await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt }));

    const after = await provider.getUserNotes(ctx(), { userId: USER_ID });
    // Pinned fixture still first; the edited authored note is still present and unpinned.
    expect(after.data!.items[0]!.id).toBe(FIXTURE_NOTE_ID);
    expect(after.data!.items[0]!.pinned).toBe(true);
    expect(after.data!.items.find((n) => n.id === id)!.pinned).toBe(false);
  });

  it("does not change page.total", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const before = (await provider.getUserNotes(ctx(), { userId: USER_ID })).data!.page.total;
    await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt }));
    const after = (await provider.getUserNotes(ctx(), { userId: USER_ID })).data!.page.total;
    expect(after).toBe(before);
  });

  it("leaves the fixture note byte-identical (immutable) after editing an authored note", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const fixtureBefore = (await provider.getUserNotes(ctx(), { userId: USER_ID })).data!.items.find((n) => n.id === FIXTURE_NOTE_ID)!;
    await provider.updateNoteBody(ctx(), edit({ noteId: id, expectedUpdatedAt: updatedAt }));
    const fixtureAfter = (await provider.getUserNotes(ctx(), { userId: USER_ID })).data!.items.find((n) => n.id === FIXTURE_NOTE_ID)!;
    expect(fixtureAfter).toEqual(fixtureBefore);
  });
});

/* ------------------------------------------------------------ capability view */

describe("getUserNotesView — provider-owned canEditBody", () => {
  it("marks the actor's own authored note editable and the fixture note not", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider, { actorId: AUTHOR });

    const view = await provider.getUserNotesView(ctx("crm_admin", AUTHOR), { userId: USER_ID });
    const own = view.data!.items.find((i) => i.note.id === id)!;
    const fixture = view.data!.items.find((i) => i.note.id === FIXTURE_NOTE_ID)!;

    expect(own.capabilities.canEditBody).toBe(true);
    expect(fixture.capabilities.canEditBody).toBe(false);
  });

  it("marks a note authored by someone else NOT editable, even for a permitted role", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider, { actorId: AUTHOR });
    const view = await provider.getUserNotesView(ctx("crm_admin", OTHER_ACTOR), { userId: USER_ID });
    expect(view.data!.items.find((i) => i.note.id === id)!.capabilities.canEditBody).toBe(false);
  });

  it.each(DENIED)("marks every note NOT editable for %s (no edit permission)", async (role) => {
    const { provider } = setup();
    await addAuthoredNote(provider, { actorId: AUTHOR });
    const view = await provider.getUserNotesView(ctx(role, AUTHOR), { userId: USER_ID });
    expect(view.data!.items.every((i) => i.capabilities.canEditBody === false)).toBe(true);
  });

  it("returns the same notes, order and total as getUserNotes", async () => {
    const { provider } = setup();
    await addAuthoredNote(provider, { key: "a", body: "Одна" });
    await addAuthoredNote(provider, { key: "b", body: "Две" });
    const plain = await provider.getUserNotes(ctx(), { userId: USER_ID });
    const view = await provider.getUserNotesView(ctx(), { userId: USER_ID });
    expect(view.data!.items.map((i) => i.note.id)).toEqual(plain.data!.items.map((n) => n.id));
    expect(view.data!.page.total).toBe(plain.data!.page.total);
  });
});

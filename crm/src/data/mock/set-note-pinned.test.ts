/**
 * setNotePinned (Phase 1B4-D).
 *
 * Validation order, permissions across all 10 roles, fixture + authored notes,
 * hidden-note security, `pinned === expectedPinned` rejection, `expectedPinned`
 * concurrency, idempotency (replay, fingerprint conflict, cross-command receipt
 * collisions), storage atomicity, fixture immutability, and the fact that the
 * effective pin is resolved from the audit log — not by mutating any note. Storage
 * is always injected: no test touches a real localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  NOTE_PIN_RECEIPT_KIND,
  PRIMARY_OWNER_RECEIPT_KIND,
  parseOverlay,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();

const USER_ID = defaultDataset(clock)[0]!.identity.userId;
/** The seeded fixture note the provider synthesises for every user. */
const FIXTURE_NOTE_ID = `${USER_ID}_note_1`;
const MISSING_USER_ID = "u_does_not_exist";

/** ROLE_PERMISSION_MATRIX §1 Edit → notes (D-53) — the SAME set that may addNote. */
const ALLOWED: readonly CrmRole[] = ["crm_admin", "crm_manager", "retention_manager", "support"];
const DENIED: readonly CrmRole[] = [
  "mentor",
  "moderator",
  "analyst",
  "content_manager",
  "read_only",
  // PHASE-1 ADMIN: the progression operator holds exactly one permission
  // (`curriculum_progress_override`) and therefore none of the note or owner
  // rights this suite classifies. Denied, explicitly.
  "progression_operator",
];

function ctx(role: CrmRole = "crm_admin", actorId = "emp_actor_1"): CrmContext {
  return { actorId, role, now: MOCK_NOW };
}

function setup(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return { provider: new MockCrmDataProvider({ clock, storage }), storage };
}

function overlayIn(storage: KeyValueStorage) {
  return parseOverlay(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY));
}

/** Pin the fixture note true. */
function pin(overrides: Partial<Parameters<MockCrmDataProvider["setNotePinned"]>[1]> = {}) {
  return {
    userId: USER_ID,
    noteId: FIXTURE_NOTE_ID,
    pinned: true,
    expectedPinned: false,
    idempotencyKey: "k1",
    ...overrides,
  };
}

/** Add an authored note and return its id. */
async function addAuthoredNote(provider: MockCrmDataProvider, key = "note-key"): Promise<string> {
  const res = await provider.addNote(ctx(), {
    userId: USER_ID,
    body: "Заметка для закрепления.",
    idempotencyKey: key,
  });
  return res.data!.note.id;
}

async function pinnedStateOf(provider: MockCrmDataProvider, noteId: string): Promise<boolean> {
  const notes = await provider.getUserNotes(ctx(), { userId: USER_ID });
  return notes.data!.items.find((n) => n.id === noteId)?.pinned ?? false;
}

/* --------------------------------------------------------------- permissions */

describe("setNotePinned — permissions across all ten roles", () => {
  it.each(ALLOWED)("%s may pin (same right as addNote — D-75)", async (role) => {
    const { provider } = setup();
    const res = await provider.setNotePinned(ctx(role), pin());
    expect(res.status).toBe("ok");
    expect(res.data?.note.pinned).toBe(true);
    expect(res.error).toBeNull();
  });

  it.each(DENIED)("%s may not pin — unauthorized, nothing written", async (role) => {
    const { provider, storage } = setup();
    const res = await provider.setNotePinned(ctx(role), pin());
    expect(res.error?.code).toBe("unauthorized");
    expect(res.data).toBeNull();
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });

  it("every role is classified exactly once", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  it("support may pin but mentor may not", async () => {
    const { provider } = setup();
    expect((await provider.setNotePinned(ctx("support"), pin())).status).toBe("ok");
    expect((await provider.setNotePinned(ctx("mentor"), pin())).error?.code).toBe("unauthorized");
  });
});

/* --------------------------------------------------- fixture + authored notes */

describe("setNotePinned — fixture and authored notes both pin and unpin", () => {
  it("pins and unpins the seeded fixture note", async () => {
    const { provider } = setup();
    const pinned = await provider.setNotePinned(ctx(), pin());
    expect(pinned.data?.note.pinned).toBe(true);
    expect(await pinnedStateOf(provider, FIXTURE_NOTE_ID)).toBe(true);

    const unpinned = await provider.setNotePinned(
      ctx(),
      pin({ pinned: false, expectedPinned: true, idempotencyKey: "k2" }),
    );
    expect(unpinned.data?.note.pinned).toBe(false);
    expect(await pinnedStateOf(provider, FIXTURE_NOTE_ID)).toBe(false);
  });

  it("pins and unpins an authored overlay note", async () => {
    const { provider } = setup();
    const noteId = await addAuthoredNote(provider);

    const pinned = await provider.setNotePinned(
      ctx(),
      pin({ noteId, idempotencyKey: "p1" }),
    );
    expect(pinned.status).toBe("ok");
    expect(await pinnedStateOf(provider, noteId)).toBe(true);

    const unpinned = await provider.setNotePinned(
      ctx(),
      pin({ noteId, pinned: false, expectedPinned: true, idempotencyKey: "p2" }),
    );
    expect(unpinned.status).toBe("ok");
    expect(await pinnedStateOf(provider, noteId)).toBe(false);
  });

  it("pinning never rewrites the stored note — the pin lives in the audit log", async () => {
    const { provider, storage } = setup();
    const noteId = await addAuthoredNote(provider);
    const storedBefore = overlayIn(storage).notes.find((n) => n.id === noteId)!;

    await provider.setNotePinned(ctx(), pin({ noteId, idempotencyKey: "p1" }));

    const storedAfter = overlayIn(storage).notes.find((n) => n.id === noteId)!;
    // The note object is byte-identical — pinned is still its `false` baseline.
    expect(storedAfter).toEqual(storedBefore);
    expect(storedAfter.pinned).toBe(false);
    // Yet the read reports it pinned, resolved from the appended audit record.
    expect(await pinnedStateOf(provider, noteId)).toBe(true);
  });
});

/* ----------------------------------------------------- hidden-note security */

describe("setNotePinned — a note the caller cannot see is not_found", () => {
  /** An overlay carrying one `private` note authored by someone else. */
  const PRIVATE_NOTE_ID = "note_mock_0001";
  const AUTHOR = "emp_private_author";
  function seededPrivate() {
    const overlay = {
      version: 1,
      sequence: 1,
      notes: [
        {
          id: PRIVATE_NOTE_ID,
          userId: USER_ID,
          caseId: null,
          authorEmployeeId: AUTHOR,
          body: "Личная заметка.",
          visibility: "private",
          pinned: false,
          createdAt: "2026-07-11T09:00:00.001Z",
          updatedAt: "2026-07-11T09:00:00.001Z",
          mock: true,
        },
      ],
      auditRecords: [],
      idempotencyReceipts: [],
    };
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify(overlay),
    });
    return { storage, provider: new MockCrmDataProvider({ clock, storage }) };
  }

  it("a non-author gets not_found — the same answer as a missing note (no probe)", async () => {
    const { provider } = seededPrivate();
    const res = await provider.setNotePinned(
      ctx("crm_admin", "emp_someone_else"),
      pin({ noteId: PRIVATE_NOTE_ID }),
    );
    expect(res.error?.code).toBe("not_found");
    expect(res.data).toBeNull();
  });

  it("the author, who can see it, may pin it", async () => {
    const { provider } = seededPrivate();
    const res = await provider.setNotePinned(
      ctx("crm_admin", AUTHOR),
      pin({ noteId: PRIVATE_NOTE_ID }),
    );
    expect(res.status).toBe("ok");
    expect(res.data?.note.pinned).toBe(true);
  });

  it("an unknown note id is not_found", async () => {
    const { provider } = setup();
    const res = await provider.setNotePinned(ctx(), pin({ noteId: "note_does_not_exist" }));
    expect(res.error?.code).toBe("not_found");
  });

  it("an unknown user is not_found", async () => {
    const { provider } = setup();
    const res = await provider.setNotePinned(ctx(), pin({ userId: MISSING_USER_ID }));
    expect(res.error?.code).toBe("not_found");
  });
});

/* ------------------------------------------------------------- invalid input */

describe("setNotePinned — invalid input", () => {
  it("rejects a command that describes no change (pinned === expectedPinned)", async () => {
    const { provider, storage } = setup();
    const res = await provider.setNotePinned(ctx(), pin({ pinned: true, expectedPinned: true }));
    expect(res.error?.code).toBe("invalid_input");
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });

  it("rejects an empty idempotency key", async () => {
    const { provider } = setup();
    expect((await provider.setNotePinned(ctx(), pin({ idempotencyKey: "   " }))).error?.code).toBe(
      "invalid_input",
    );
  });

  it("rejects an over-long idempotency key", async () => {
    const { provider } = setup();
    const res = await provider.setNotePinned(
      ctx(),
      pin({ idempotencyKey: "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an empty note id", async () => {
    const { provider } = setup();
    expect((await provider.setNotePinned(ctx(), pin({ noteId: "  " }))).error?.code).toBe(
      "invalid_input",
    );
  });

  it("invalid_input is checked before the note is looked up", async () => {
    // A no-change command against a missing note is still invalid_input, not
    // not_found — validation precedes existence, as documented.
    const { provider } = setup();
    const res = await provider.setNotePinned(
      ctx(),
      pin({ noteId: "nope", pinned: false, expectedPinned: false }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });
});

/* --------------------------------------------------------- concurrency */

describe("setNotePinned — expectedPinned concurrency", () => {
  it("a stale expectedPinned is a conflict, and writes nothing", async () => {
    const { provider, storage } = setup();
    // Winner pins the note, so its effective state is now true.
    await provider.setNotePinned(ctx(), pin({ idempotencyKey: "winner" }));
    const before = overlayIn(storage);

    // Loser still believes the note is unpinned and tries to pin it — a valid
    // transition shape (pinned true ≠ expected false), but expectedPinned=false no
    // longer matches the effective true.
    const res = await provider.setNotePinned(
      ctx(),
      pin({ pinned: true, expectedPinned: false, idempotencyKey: "loser" }),
    );
    expect(res.error?.code).toBe("conflict");
    expect(res.data).toBeNull();
    // Nothing written; the winner's pin still stands.
    expect(overlayIn(storage)).toEqual(before);
  });

  it("an unpin whose expectedPinned is stale is also a conflict", async () => {
    const { provider, storage } = setup();
    // The note starts unpinned; a caller who thinks it is pinned tries to unpin.
    const res = await provider.setNotePinned(
      ctx(),
      pin({ pinned: false, expectedPinned: true, idempotencyKey: "stale-unpin" }),
    );
    expect(res.error?.code).toBe("conflict");
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });
});

/* --------------------------------------------------------- idempotency */

describe("setNotePinned — idempotency", () => {
  it("replays the same command under the same key without a second audit", async () => {
    const { provider, storage } = setup();
    const first = await provider.setNotePinned(ctx(), pin());
    expect(first.data?.replayed).toBe(false);
    const after = overlayIn(storage);

    const replay = await provider.setNotePinned(ctx(), pin());
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.note.pinned).toBe(true);
    // No second audit record and no second receipt.
    expect(overlayIn(storage)).toEqual(after);
    expect(overlayIn(storage).auditRecords).toHaveLength(1);
  });

  it("a key reused for a different pin command is a conflict", async () => {
    const { provider } = setup();
    const noteId = await addAuthoredNote(provider);
    await provider.setNotePinned(ctx(), pin({ idempotencyKey: "shared" }));
    // Same key, different note id → different fingerprint → conflict.
    const res = await provider.setNotePinned(
      ctx(),
      pin({ noteId, idempotencyKey: "shared" }),
    );
    expect(res.error?.code).toBe("conflict");
  });

  it("differs by actor and by role in the fingerprint", async () => {
    const { provider } = setup();
    await provider.setNotePinned(ctx("crm_admin", "emp_a"), pin({ idempotencyKey: "shared" }));
    // Same key, different actor → conflict.
    const byActor = await provider.setNotePinned(
      ctx("crm_admin", "emp_b"),
      pin({ idempotencyKey: "shared" }),
    );
    expect(byActor.error?.code).toBe("conflict");
    // Same key, different role → conflict.
    const byRole = await provider.setNotePinned(
      ctx("crm_manager", "emp_a"),
      pin({ idempotencyKey: "shared" }),
    );
    expect(byRole.error?.code).toBe("conflict");
  });

  it("an addNote receipt cannot be reused for a pin", async () => {
    const { provider } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Заметка.", idempotencyKey: "shared" });
    const res = await provider.setNotePinned(ctx(), pin({ idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("an owner-assignment receipt cannot be reused for a pin", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), {
      userId: USER_ID,
      ownerId: "emp_ret2",
      expectedOwnerId: defaultDataset(clock)[0]!.operations.primaryOwnerId,
      idempotencyKey: "shared",
    });
    const res = await provider.setNotePinned(ctx(), pin({ idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("writes a pin receipt of the note_pin_change kind with no noteId field", async () => {
    const { provider, storage } = setup();
    await provider.setNotePinned(ctx(), pin());
    const receipt = overlayIn(storage).idempotencyReceipts.at(-1)!;
    expect(receipt.kind).toBe(NOTE_PIN_RECEIPT_KIND);
    expect(receipt.kind).not.toBe(PRIMARY_OWNER_RECEIPT_KIND);
    expect("noteId" in receipt).toBe(false);
  });
});

/* --------------------------------------------------------- audit contents */

describe("setNotePinned — audit record", () => {
  it("records the fact and the direction, and no content", async () => {
    const { provider, storage } = setup();
    await provider.setNotePinned(ctx("crm_manager", "emp_x"), pin());
    const audit = overlayIn(storage).auditRecords.at(-1)!;
    expect(audit.action).toBe("note_pin_changed");
    expect(audit).toMatchObject({
      entityType: "note",
      entityId: FIXTURE_NOTE_ID,
      targetUserId: USER_ID,
      actorEmployeeId: "emp_x",
      actorRole: "crm_manager",
      reasonCode: "note_pin_changed_by_employee",
      mock: true,
    });
    if (audit.action !== "note_pin_changed") throw new Error("unreachable");
    expect(audit.previousPinned).toBe(false);
    expect(audit.nextPinned).toBe(true);
    // No body, no key, no fingerprint on the audit record.
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("Синтетическая");
    expect(serialized).not.toContain("k1");
  });
});

/* ------------------------------------------------------- storage atomicity */

describe("setNotePinned — storage failure is atomic", () => {
  it("a failed persist writes nothing and does not burn the key", async () => {
    const failing = new MemoryKeyValueStorage();
    let broken = true;
    const original = failing.setItem.bind(failing);
    failing.setItem = (k: string, v: string) => {
      if (broken) throw new Error("quota");
      original(k, v);
    };
    const provider = new MockCrmDataProvider({ clock, storage: failing });

    const first = await provider.setNotePinned(ctx(), pin());
    expect(first.error?.code).toBe("internal");
    expect(first.error?.retriable).toBe(true);
    expect(overlayIn(failing).auditRecords).toHaveLength(0);

    broken = false;
    const retry = await provider.setNotePinned(ctx(), pin());
    expect(retry.status).toBe("ok");
    expect(retry.data?.replayed).toBe(false);
  });
});

/* ------------------------------------------------ effective-pin resolution */

describe("setNotePinned — effective pin is resolved from the log", () => {
  it("the latest of several pin changes wins", async () => {
    const { provider } = setup();
    await provider.setNotePinned(ctx(), pin({ idempotencyKey: "a" })); // pin
    await provider.setNotePinned(
      ctx(),
      pin({ pinned: false, expectedPinned: true, idempotencyKey: "b" }),
    ); // unpin
    await provider.setNotePinned(
      ctx(),
      pin({ pinned: true, expectedPinned: false, idempotencyKey: "c" }),
    ); // pin again
    expect(await pinnedStateOf(provider, FIXTURE_NOTE_ID)).toBe(true);
  });

  it("a fresh provider over the same storage sees the pin", async () => {
    const { provider, storage } = setup();
    await provider.setNotePinned(ctx(), pin());
    const fresh = new MockCrmDataProvider({ clock, storage });
    expect(await pinnedStateOf(fresh, FIXTURE_NOTE_ID)).toBe(true);
  });

  it("pinned-first ordering is provider-owned — a pinned older note sorts above a newer one", async () => {
    const { provider } = setup();
    const authoredId = await addAuthoredNote(provider); // newer than the fixture note
    const before = await provider.getUserNotes(ctx(), { userId: USER_ID });
    // Newest first by default: the authored note leads, the fixture note trails.
    expect(before.data!.items[0]!.id).toBe(authoredId);
    expect(before.data!.items.at(-1)!.id).toBe(FIXTURE_NOTE_ID);

    // Pin the OLDER fixture note — it must jump to the top.
    await provider.setNotePinned(ctx(), pin({ idempotencyKey: "p" }));
    const pinned = await provider.getUserNotes(ctx(), { userId: USER_ID });
    expect(pinned.data!.items[0]!.id).toBe(FIXTURE_NOTE_ID);

    // Unpin it — the newest-first order returns.
    await provider.setNotePinned(
      ctx(),
      pin({ pinned: false, expectedPinned: true, idempotencyKey: "u" }),
    );
    const unpinned = await provider.getUserNotes(ctx(), { userId: USER_ID });
    expect(unpinned.data!.items[0]!.id).toBe(authoredId);
  });
});

/* ------------------------------------------------------- fixture immutability */

describe("setNotePinned — the fixture dataset is never mutated", () => {
  it("pinning a fixture note leaves defaultDataset untouched", async () => {
    const { provider } = setup();
    await provider.setNotePinned(ctx(), pin());
    // A freshly built dataset still has no pinned notes anywhere — the pin is
    // overlay-derived, never written back onto the fixture.
    const fresh = defaultDataset(clock);
    expect(fresh[0]!.operations).toBeDefined();
    // The fixture note the provider synthesises is still pinned:false at baseline
    // for a brand-new provider with an empty overlay.
    const clean = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    const notes = await clean.getUserNotes(ctx(), { userId: USER_ID });
    expect(notes.data!.items.every((n) => !n.pinned)).toBe(true);
  });
});

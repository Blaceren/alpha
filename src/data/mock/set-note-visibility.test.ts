/**
 * setNoteVisibility (Phase 1B5-C).
 *
 * Validation/security order (mirrors updateNoteBody), permissions across all 9
 * roles, the authored-only and author-only boundaries (proven with DISTINCT actor
 * ids, NOT the demo's shared `emp_mock_admin`), `role_restricted` refusal, fixture
 * immutability, hidden-note indistinguishability, identity-based `private`
 * visibility, `expectedUpdatedAt` concurrency, idempotency (replay, replay after a
 * later change, fingerprint conflict, cross-command receipt collisions), storage
 * atomicity, and the fact the audit/receipt carry no body or visibility labels.
 * Storage is always injected: no test touches a real localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  NOTE_BODY_RECEIPT_KIND,
  NOTE_VISIBILITY_RECEIPT_KIND,
  parseOverlay,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import type { SetNoteVisibilityCommand } from "@/data/contracts/CrmMutations";
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

function cmd(overrides: Partial<SetNoteVisibilityCommand> = {}): SetNoteVisibilityCommand {
  return {
    userId: USER_ID,
    noteId: "note_mock_0001",
    visibility: "private",
    expectedUpdatedAt: MOCK_NOW,
    idempotencyKey: "vis-key",
    ...overrides,
  };
}

/** Read a note's stored visibility as seen by an actor. */
async function visibilityOf(
  provider: MockCrmDataProvider,
  noteId: string,
  actorId = AUTHOR,
): Promise<string | undefined> {
  const notes = await provider.getUserNotes(ctx("crm_admin", actorId), { userId: USER_ID });
  return notes.data!.items.find((n) => n.id === noteId)?.visibility;
}

/* --------------------------------------------------------------- success */

describe("setNoteVisibility — success", () => {
  it("changes team → private and writes one fact-only audit record", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);

    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    expect(res.status).toBe("ok");
    expect(res.data?.replayed).toBe(false);
    expect(res.data?.noteId).toBe(id);
    // One mutation timestamp: result.updatedAt === note.updatedAt === audit.at (D-83).
    const at = res.data!.updatedAt;
    expect(res.data!.audit.at).toBe(at);

    const audit = res.data!.audit;
    expect(audit.action).toBe("note_visibility_changed");
    if (audit.action === "note_visibility_changed") {
      expect(audit.previousVisibility).toBe("team");
      expect(audit.nextVisibility).toBe("private");
      expect(audit.entityId).toBe(id);
      expect(audit.reasonCode).toBe("note_visibility_changed_by_employee");
    }

    const overlay = overlayIn(storage);
    const stored = overlay.notes.find((n) => n.id === id)!;
    expect(stored.visibility).toBe("private");
    expect(stored.updatedAt).toBe(at);
    // Only visibility + updatedAt changed.
    expect(stored.body).toBe("Исходное тело заметки.");
    expect(stored.pinned).toBe(false);
    expect(stored.authorEmployeeId).toBe(AUTHOR);
  });

  it("changes private → team", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const first = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt, idempotencyKey: "k1" }),
    );
    const back = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, visibility: "team", expectedUpdatedAt: first.data!.updatedAt, idempotencyKey: "k2" }),
    );
    expect(back.status).toBe("ok");
    if (back.data!.audit.action === "note_visibility_changed") {
      expect(back.data!.audit.previousVisibility).toBe("private");
      expect(back.data!.audit.nextVisibility).toBe("team");
    }
    expect(await visibilityOf(provider, id)).toBe("team");
  });

  it("carries no body anywhere in the result or audit", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { body: "СЕКРЕТНОЕ_ТЕЛО" });
    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    expect(JSON.stringify(res.data)).not.toContain("СЕКРЕТНОЕ_ТЕЛО");
  });
});

/* ------------------------------------------------------------ validation */

describe("setNoteVisibility — validation", () => {
  it("rejects role_restricted with invalid_input", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(
      ctx(),
      // Cast: the type forbids it, but a malformed caller must still be refused.
      cmd({ noteId: id, expectedUpdatedAt: updatedAt, visibility: "role_restricted" as "team" }),
    );
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an unknown visibility value with invalid_input", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, expectedUpdatedAt: updatedAt, visibility: "public" as "team" }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects a missing/blank idempotency key", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "  " }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an over-long idempotency key", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects a malformed expectedUpdatedAt", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: "not-a-date" }));
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects a no-op (same visibility) and writes nothing", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);
    const res = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, visibility: "team", expectedUpdatedAt: updatedAt }),
    );
    expect(res.error?.code).toBe("invalid_input");
    // No audit, no receipt, no updatedAt change — the overlay is byte-identical.
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
  });
});

/* -------------------------------------------------- entity boundaries */

describe("setNoteVisibility — entity boundaries", () => {
  it("returns not_found for an unknown user", async () => {
    const { provider } = setup();
    await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(ctx(), cmd({ userId: MISSING_USER_ID }));
    expect(res.error?.code).toBe("not_found");
  });

  it("returns not_found for an unknown note", async () => {
    const { provider } = setup();
    await addAuthoredNote(provider);
    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: "note_mock_9999" }));
    expect(res.error?.code).toBe("not_found");
  });

  it("returns invalid_input for the immutable fixture note (not not_found)", async () => {
    const { provider } = setup();
    const res = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: FIXTURE_NOTE_ID, expectedUpdatedAt: MOCK_NOW }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });

  it("returns unauthorized for a note authored by another employee", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    // OTHER_ACTOR holds the permission (admin) but did not author the note.
    const res = await provider.setNoteVisibility(
      ctx("crm_admin", OTHER_ACTOR),
      cmd({ noteId: id, expectedUpdatedAt: updatedAt }),
    );
    expect(res.error?.code).toBe("unauthorized");
  });

  it("returns not_found (not unauthorized) for a hidden private note of another author", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR });
    // AUTHOR turns it private.
    await provider.setNoteVisibility(ctx("crm_admin", AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    // OTHER_ACTOR cannot even see it → not_found, never an existence oracle.
    const res = await provider.setNoteVisibility(
      ctx("crm_admin", OTHER_ACTOR),
      cmd({ noteId: id, visibility: "team" }),
    );
    expect(res.error?.code).toBe("not_found");
  });
});

/* -------------------------------------------------- concurrency / idempotency */

describe("setNoteVisibility — concurrency & idempotency", () => {
  it("returns conflict on a stale expectedUpdatedAt and leaves the overlay unchanged", async () => {
    const { provider, storage } = setup();
    const { id } = await addAuthoredNote(provider);
    const before = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);
    const res = await provider.setNoteVisibility(
      ctx(),
      cmd({ noteId: id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    );
    expect(res.error?.code).toBe("conflict");
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBe(before);
  });

  it("replays the same command under the same key (replayed: true)", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const first = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "same" }));
    const again = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "same" }));
    expect(again.status).toBe("ok");
    expect(again.data?.replayed).toBe(true);
    expect(again.data?.audit.id).toBe(first.data?.audit.id);
  });

  it("still replays after a LATER visibility change advanced updatedAt", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    const first = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt, idempotencyKey: "K" }));
    // A later change under a different key advances updatedAt.
    await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "team", expectedUpdatedAt: first.data!.updatedAt, idempotencyKey: "L" }));
    // Re-sending K with its ORIGINAL stale expectedUpdatedAt must still replay.
    const replay = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt, idempotencyKey: "K" }));
    expect(replay.data?.replayed).toBe(true);
    expect(replay.data?.updatedAt).toBe(first.data?.updatedAt);
  });

  it("conflicts when the same key is reused for a different visibility/note/actor/role", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt, idempotencyKey: "dup" }));

    // Different desired visibility under the same key.
    const diffVis = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "team", idempotencyKey: "dup" }));
    expect(diffVis.error?.code).toBe("conflict");

    // Different role under the same key.
    const diffRole = await provider.setNoteVisibility(ctx("crm_manager"), cmd({ noteId: id, visibility: "private", idempotencyKey: "dup" }));
    expect(diffRole.error?.code).toBe("conflict");
  });

  it("conflicts when the key already belongs to a different command KIND", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    // Spend the key on a body edit first.
    await provider.updateNoteBody(ctx(), {
      userId: USER_ID,
      noteId: id,
      body: "Новое тело заметки.",
      expectedUpdatedAt: updatedAt,
      idempotencyKey: "shared",
    });
    // Reuse it for a visibility change → cross-kind conflict.
    const res = await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "private", idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });
});

/* -------------------------------------------------- persistence / atomicity */

describe("setNoteVisibility — persistence & atomicity", () => {
  it("persists across a fresh provider over the same storage, and retry after a storage failure works", async () => {
    const storage = new MemoryKeyValueStorage();
    const { provider } = setup(storage);
    const { id, updatedAt } = await addAuthoredNote(provider);

    // A storage that throws once, on the visibility write only.
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

    const failed = await flaky.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "retry" }));
    expect(failed.error?.code).toBe("internal");
    // Nothing half-written: the note is still team.
    expect(await visibilityOf(provider, id)).toBe("team");

    // Retry under the SAME key now succeeds — nothing was written the first time.
    const ok = await flaky.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt, idempotencyKey: "retry" }));
    expect(ok.status).toBe("ok");

    // A brand-new provider over the same storage reads the change.
    const reloaded = new MockCrmDataProvider({ clock, storage });
    expect(await visibilityOf(reloaded, id)).toBe("private");
  });

  it("preserves the fixture note and every other note's body/pin/order", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { body: "Первая", key: "n1" });
    // A second authored note that must be untouched.
    const second = await provider.addNote(ctx(), { userId: USER_ID, body: "Вторая", idempotencyKey: "n2" });
    const secondId = second.data!.note.id;

    const before = await provider.getUserNotes(ctx(), { userId: USER_ID });
    await provider.setNoteVisibility(ctx(), cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt }));
    const after = await provider.getUserNotes(ctx(), { userId: USER_ID });

    // The fixture note is still present and unchanged.
    expect(after.data!.items.find((n) => n.id === FIXTURE_NOTE_ID)?.body).toBe(
      before.data!.items.find((n) => n.id === FIXTURE_NOTE_ID)?.body,
    );
    // The other authored note is byte-identical.
    const secBefore = before.data!.items.find((n) => n.id === secondId)!;
    const secAfter = after.data!.items.find((n) => n.id === secondId)!;
    expect(secAfter).toEqual(secBefore);
    // Order preserved (both reads are newest-first / pinned-first).
    expect(after.data!.items.map((n) => n.id)).toEqual(before.data!.items.map((n) => n.id));
  });

  it("stores exactly one visibility receipt, and never a body receipt", async () => {
    const { provider, storage } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider);
    await provider.setNoteVisibility(ctx(), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
    const receipts = overlayIn(storage).idempotencyReceipts;
    const kinds = receipts.map((r) => r.kind);
    expect(kinds).toContain(NOTE_VISIBILITY_RECEIPT_KIND);
    expect(kinds).not.toContain(NOTE_BODY_RECEIPT_KIND);
  });
});

/* -------------------------------------------------- permissions × 9 */

describe("setNoteVisibility — permission across all ten roles", () => {
  it("covers every CRM role exactly once", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  for (const role of ALLOWED) {
    it(`${role} may change its OWN authored note`, async () => {
      const { provider } = setup();
      const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role });
      const res = await provider.setNoteVisibility(ctx(role, AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
      expect(res.status).toBe("ok");
    });
  }

  for (const role of DENIED) {
    it(`${role} is unauthorized even for its own authored note`, async () => {
      // Seed the note as an allowed role (so it exists and is authored by AUTHOR),
      // then attempt the change under a denied role with the SAME actor id.
      const { provider } = setup();
      const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
      const res = await provider.setNoteVisibility(ctx(role, AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));
      expect(res.status).toBe("error");
      expect(res.error?.code).toBe("unauthorized");
    });
  }
});

/* -------------------------------------------------- identity semantics */

describe("setNoteVisibility — private is identity-based, not role-based", () => {
  it("keeps a private note visible to its author after a ROLE switch (same actorId)", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
    await provider.setNoteVisibility(ctx("crm_admin", AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    // Same actor, a DIFFERENT role that lacks edit rights — still the author, still sees it.
    const asReadOnly = await provider.getUserNotes(ctx("read_only", AUTHOR), { userId: USER_ID });
    expect(asReadOnly.data!.items.some((n) => n.id === id)).toBe(true);
  });

  it("hides a private note from a DIFFERENT actor, even one with the admin role", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
    await provider.setNoteVisibility(ctx("crm_admin", AUTHOR), cmd({ noteId: id, expectedUpdatedAt: updatedAt }));

    const asOtherAdmin = await provider.getUserNotes(ctx("crm_admin", OTHER_ACTOR), { userId: USER_ID });
    expect(asOtherAdmin.data!.items.some((n) => n.id === id)).toBe(false);
    // The private note is also absent from the count a foreign actor sees.
    expect(asOtherAdmin.data!.page.total).toBe(
      asOtherAdmin.data!.items.length,
    );
  });

  it("re-exposes the note to a foreign actor once it is turned back to team", async () => {
    const { provider } = setup();
    const { id, updatedAt } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
    const priv = await provider.setNoteVisibility(ctx("crm_admin", AUTHOR), cmd({ noteId: id, visibility: "private", expectedUpdatedAt: updatedAt, idempotencyKey: "p" }));
    await provider.setNoteVisibility(ctx("crm_admin", AUTHOR), cmd({ noteId: id, visibility: "team", expectedUpdatedAt: priv.data!.updatedAt, idempotencyKey: "t" }));

    const asOther = await provider.getUserNotes(ctx("crm_admin", OTHER_ACTOR), { userId: USER_ID });
    expect(asOther.data!.items.some((n) => n.id === id)).toBe(true);
  });
});

/* -------------------------------------------------- capability (getUserNotesView) */

describe("getUserNotesView — canChangeVisibility capability", () => {
  it("is true only for the author with edit rights, on their overlay note", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });

    const asAuthor = await provider.getUserNotesView(ctx("crm_admin", AUTHOR), { userId: USER_ID });
    const authored = asAuthor.data!.items.find((i) => i.note.id === id)!;
    expect(authored.capabilities.canChangeVisibility).toBe(true);
    // The generated fixture note is never changeable.
    const fixture = asAuthor.data!.items.find((i) => i.note.id === FIXTURE_NOTE_ID)!;
    expect(fixture.capabilities.canChangeVisibility).toBe(false);
  });

  it("is false for the author under a role without edit rights", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
    const asReadOnly = await provider.getUserNotesView(ctx("read_only", AUTHOR), { userId: USER_ID });
    const authored = asReadOnly.data!.items.find((i) => i.note.id === id)!;
    // The author still SEES the note (team) and its body, but gets no control.
    expect(authored).toBeTruthy();
    expect(authored.capabilities.canChangeVisibility).toBe(false);
  });

  it("is false for a foreign actor even with the admin role", async () => {
    const { provider } = setup();
    const { id } = await addAuthoredNote(provider, { actorId: AUTHOR, role: "crm_admin" });
    const asOther = await provider.getUserNotesView(ctx("crm_admin", OTHER_ACTOR), { userId: USER_ID });
    const authored = asOther.data!.items.find((i) => i.note.id === id)!;
    expect(authored.capabilities.canChangeVisibility).toBe(false);
  });
});

/**
 * addNote — the only mutation in Phase 1B4-A.
 * Validation, permissions across all 10 roles, determinism, idempotency, overlay
 * persistence. Storage is always injected: no test touches a real localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  MutationOverlayStore,
  parseOverlay,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { NOTE_BODY_MAX_LENGTH } from "@/domain/notes/note";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();
const USER_ID = defaultDataset(clock)[0]!.identity.userId;
const OTHER_USER_ID = defaultDataset(clock)[1]!.identity.userId;
const MISSING_USER_ID = "u_does_not_exist";

/** Documented Edit→notes roles (ROLE_PERMISSION_MATRIX §1, D-53). */
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

describe("addNote — success", () => {
  it("creates one team note and one audit record", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Позвонил пользователю",
      idempotencyKey: "k1",
    });

    expect(res.status).toBe("ok");
    expect(res.error).toBeNull();
    expect(res.data?.replayed).toBe(false);
    expect(res.data?.note.body).toBe("Позвонил пользователю");
    expect(res.data?.note.visibility).toBe("team");
    expect(res.data?.note.userId).toBe(USER_ID);
    expect(res.data?.note.mock).toBe(true);

    const overlay = overlayIn(storage);
    expect(overlay.notes).toHaveLength(1);
    expect(overlay.auditRecords).toHaveLength(1);
    expect(overlay.idempotencyReceipts).toHaveLength(1);
  });

  it("takes the author from ctx, not from the command", async () => {
    const { provider } = setup();
    const res = await provider.addNote(
      ctx("support", "emp_support_7"),
      // A caller trying to name a different actor: extra keys are not part of the
      // command type and must not reach the note.
      {
        userId: USER_ID,
        body: "Заметка",
        idempotencyKey: "k1",
        actorId: "emp_admin_hacker",
        role: "crm_admin",
      } as never,
    );

    expect(res.data?.note.authorEmployeeId).toBe("emp_support_7");
    expect(res.data?.audit.actorEmployeeId).toBe("emp_support_7");
    expect(res.data?.audit.actorRole).toBe("support");
  });

  it("sets updatedAt equal to createdAt on creation", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    expect(res.data?.note.updatedAt).toBe(res.data?.note.createdAt);
  });

  it("does not return raw storage state", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    expect(Object.keys(res.data ?? {}).sort()).toEqual(["audit", "note", "replayed"]);
  });
});

describe("addNote — body validation", () => {
  it("trims the body before storing", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "   отступы   ",
      idempotencyKey: "k1",
    });

    expect(res.data?.note.body).toBe("отступы");
    expect(overlayIn(storage).notes[0]!.body).toBe("отступы");
  });

  it("rejects an empty body", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "", idempotencyKey: "k1" });

    expect(res.error?.code).toBe("invalid_input");
    expect(overlayIn(storage).notes).toHaveLength(0);
  });

  it("rejects a whitespace-only body", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "    \n  ",
      idempotencyKey: "k1",
    });
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an over-limit body and accepts one at the limit", async () => {
    const { provider } = setup();
    const tooLong = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "x".repeat(NOTE_BODY_MAX_LENGTH + 1),
      idempotencyKey: "k1",
    });
    expect(tooLong.error?.code).toBe("invalid_input");

    const atLimit = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "x".repeat(NOTE_BODY_MAX_LENGTH),
      idempotencyKey: "k2",
    });
    expect(atLimit.status).toBe("ok");
  });

  it("stores the body as plain text, without interpreting markup", async () => {
    const { provider } = setup();
    const body = '<script>alert("x")</script>';
    const res = await provider.addNote(ctx(), { userId: USER_ID, body, idempotencyKey: "k1" });
    expect(res.data?.note.body).toBe(body);
  });
});

describe("addNote — idempotency key validation", () => {
  it("rejects a missing key", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "" });

    expect(res.error?.code).toBe("invalid_input");
    expect(overlayIn(storage).notes).toHaveLength(0);
  });

  it("rejects a whitespace-only key", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "   " });
    expect(res.error?.code).toBe("invalid_input");
  });

  it("rejects an over-long key", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
    });
    expect(res.error?.code).toBe("invalid_input");
  });

  it("trims the key: the same key with padding is the same key", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    const replay = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "  k1  ",
    });

    expect(replay.data?.replayed).toBe(true);
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("does not use the key as an entity id", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "my-custom-key",
    });

    expect(res.data?.note.id).not.toContain("my-custom-key");
    expect(res.data?.audit.id).not.toContain("my-custom-key");
  });
});

describe("addNote — unknown user", () => {
  it("returns not_found and writes nothing", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(), {
      userId: MISSING_USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });

    expect(res.error?.code).toBe("not_found");
    expect(overlayIn(storage).notes).toHaveLength(0);
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });
});

describe("addNote — permissions across all 10 roles", () => {
  it("covers every role in the matrix exactly once", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  it.each(ALLOWED)("%s may add a note (documented Edit → notes)", async (role) => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(role), {
      userId: USER_ID,
      body: "Заметка",
      idempotencyKey: "k1",
    });

    expect(res.status).toBe("ok");
    expect(res.data?.note.body).toBe("Заметка");
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it.each(DENIED)("%s may not add a note (no documented Edit → notes)", async (role) => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx(role), {
      userId: USER_ID,
      body: "Заметка",
      idempotencyKey: "k1",
    });

    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("unauthorized");
    expect(res.data).toBeNull();
    expect(overlayIn(storage).notes).toHaveLength(0);
  });

  it.each(DENIED)("a refusal for %s creates no audit record and no receipt", async (role) => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(role), { userId: USER_ID, body: "Заметка", idempotencyKey: "k1" });

    const overlay = overlayIn(storage);
    expect(overlay.auditRecords).toHaveLength(0);
    expect(overlay.idempotencyReceipts).toHaveLength(0);
    expect(overlay.sequence).toBe(0);
  });

  it.each(DENIED)("the refusal for %s never echoes the note body", async (role) => {
    const { provider } = setup();
    const body = "СЕКРЕТНОЕ-СОДЕРЖИМОЕ-ЗАМЕТКИ";
    const res = await provider.addNote(ctx(role), { userId: USER_ID, body, idempotencyKey: "k1" });

    expect(JSON.stringify(res)).not.toContain(body);
    expect(JSON.stringify(res)).not.toContain("СЕКРЕТНОЕ");
  });

  it("decides on ctx.role, not on anything the command claims", async () => {
    const { provider, storage } = setup();
    const res = await provider.addNote(ctx("read_only"), {
      userId: USER_ID,
      body: "Заметка",
      idempotencyKey: "k1",
      role: "crm_admin",
    } as never);

    expect(res.error?.code).toBe("unauthorized");
    expect(overlayIn(storage).notes).toHaveLength(0);
  });

  it("a denied role also cannot write via a forbidden->allowed key reuse", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx("analyst"), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
    expect(overlayIn(storage).idempotencyReceipts).toHaveLength(0);

    const allowed = await provider.addNote(ctx("crm_admin"), {
      userId: USER_ID,
      body: "A",
      idempotencyKey: "k1",
    });
    expect(allowed.status).toBe("ok");
    expect(allowed.data?.replayed).toBe(false);
  });
});

describe("addNote — idempotency semantics", () => {
  it("replays the original result for the same key and payload", async () => {
    const { provider, storage } = setup();
    const first = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Одна заметка",
      idempotencyKey: "k1",
    });
    const second = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Одна заметка",
      idempotencyKey: "k1",
    });

    expect(second.status).toBe("ok");
    expect(second.data?.replayed).toBe(true);
    expect(second.data?.note).toEqual(first.data?.note);
    expect(second.data?.audit).toEqual(first.data?.audit);
  });

  it("replays for a payload that only differs before normalization", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Текст", idempotencyKey: "k1" });
    const replay = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "   Текст   ",
      idempotencyKey: "k1",
    });

    expect(replay.data?.replayed).toBe(true);
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("does not create a duplicate note", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });

    const overlay = overlayIn(storage);
    expect(overlay.notes).toHaveLength(1);
    expect(overlay.sequence).toBe(1);
  });

  it("does not create a duplicate audit record", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });

    expect(overlayIn(storage).auditRecords).toHaveLength(1);
    expect(overlayIn(storage).idempotencyReceipts).toHaveLength(1);
  });

  it("same key + different body → conflict", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Первый", idempotencyKey: "k1" });
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Второй",
      idempotencyKey: "k1",
    });

    expect(res.error?.code).toBe("conflict");
    expect(res.data).toBeNull();
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("same key + different user → conflict", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    const res = await provider.addNote(ctx(), {
      userId: OTHER_USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });

    expect(res.error?.code).toBe("conflict");
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("same key + different actor → conflict", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx("crm_admin", "emp_a"), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });
    const res = await provider.addNote(ctx("crm_admin", "emp_b"), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });

    expect(res.error?.code).toBe("conflict");
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("same key + same actor but a different role → conflict", async () => {
    const { provider } = setup();
    await provider.addNote(ctx("crm_admin", "emp_a"), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });
    const res = await provider.addNote(ctx("support", "emp_a"), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });

    expect(res.error?.code).toBe("conflict");
  });

  it("a conflict never leaks the stored body", async () => {
    const { provider } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "ПЕРВОЕ-ТЕЛО", idempotencyKey: "k1" });
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "ВТОРОЕ-ТЕЛО",
      idempotencyKey: "k1",
    });

    expect(JSON.stringify(res)).not.toContain("ПЕРВОЕ-ТЕЛО");
    expect(JSON.stringify(res)).not.toContain("ВТОРОЕ-ТЕЛО");
  });

  it("a receipt does not store the body a second time", async () => {
    const { provider, storage } = setup();
    const body = "УНИКАЛЬНОЕ-ТЕЛО-ЗАМЕТКИ";
    await provider.addNote(ctx(), { userId: USER_ID, body, idempotencyKey: "k1" });

    const receipts = JSON.stringify(overlayIn(storage).idempotencyReceipts);
    expect(receipts).not.toContain(body);
    expect(receipts).not.toContain("УНИКАЛЬНОЕ");
  });

  it("different keys create separate notes", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Первая", idempotencyKey: "k1" });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Вторая", idempotencyKey: "k2" });

    expect(overlayIn(storage).notes).toHaveLength(2);
    expect(overlayIn(storage).sequence).toBe(2);
  });
});

describe("addNote — determinism", () => {
  it("derives note and audit ids from the sequence, never randomly", async () => {
    const { provider } = setup();
    const first = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
    const second = await provider.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });

    expect(first.data?.note.id).toBe("note_mock_0001");
    expect(first.data?.audit.id).toBe("audit_mock_0001");
    expect(second.data?.note.id).toBe("note_mock_0002");
    expect(second.data?.audit.id).toBe("audit_mock_0002");
  });

  it("produces identical ids and timestamps across two independent runs", async () => {
    const runOnce = async () => {
      const { provider } = setup();
      const a = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
      const b = await provider.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });
      return [a.data?.note, b.data?.note];
    };

    expect(await runOnce()).toEqual(await runOnce());
  });

  it("gives each note a deterministic timestamp offset by its sequence", async () => {
    const { provider } = setup();
    const first = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
    const second = await provider.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });

    const base = new Date(MOCK_NOW).getTime();
    expect(first.data?.note.createdAt).toBe(new Date(base + 1).toISOString());
    expect(second.data?.note.createdAt).toBe(new Date(base + 2).toISOString());
    expect(second.data?.audit.at).toBe(second.data?.note.createdAt);
  });

  it("keeps timestamps strictly increasing under a fixed clock", async () => {
    const { provider } = setup();
    const a = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });
    const b = await provider.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });

    expect(Date.parse(b.data!.note.createdAt)).toBeGreaterThan(Date.parse(a.data!.note.createdAt));
  });

  it("does not read the real system clock", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });

    // MOCK_NOW is fixed in 2026; a real Date.now() could never land on it.
    expect(res.data?.note.createdAt.startsWith("2026-07-13T09:00:00")).toBe(true);
  });
});

describe("addNote — persisted sequence", () => {
  it("continues the sequence after the adapter is recreated", async () => {
    const storage = new MemoryKeyValueStorage();
    const first = new MockCrmDataProvider({ clock, storage });
    await first.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });

    const rebuilt = new MockCrmDataProvider({ clock, storage });
    const res = await rebuilt.addNote(ctx(), { userId: USER_ID, body: "B", idempotencyKey: "k2" });

    expect(res.data?.note.id).toBe("note_mock_0002");
    expect(overlayIn(storage).sequence).toBe(2);
    expect(overlayIn(storage).notes).toHaveLength(2);
  });

  it("honors a receipt written before the adapter was recreated", async () => {
    const storage = new MemoryKeyValueStorage();
    await new MockCrmDataProvider({ clock, storage }).addNote(ctx(), {
      userId: USER_ID,
      body: "A",
      idempotencyKey: "k1",
    });

    const rebuilt = new MockCrmDataProvider({ clock, storage });
    const replay = await rebuilt.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });

    expect(replay.data?.replayed).toBe(true);
    expect(overlayIn(storage).notes).toHaveLength(1);
  });

  it("starts from an empty overlay when persisted data is unreadable", async () => {
    const storage = new MemoryKeyValueStorage({ [MUTATION_OVERLAY_STORAGE_KEY]: "{corrupt" });
    const provider = new MockCrmDataProvider({ clock, storage });
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "A", idempotencyKey: "k1" });

    expect(res.data?.note.id).toBe("note_mock_0001");
  });

  it("ignores an overlay written under an unknown version", async () => {
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify({
        version: 99,
        sequence: 500,
        notes: [],
        auditRecords: [],
        idempotencyReceipts: [],
      }),
    });
    const res = await new MockCrmDataProvider({ clock, storage }).addNote(ctx(), {
      userId: USER_ID,
      body: "A",
      idempotencyKey: "k1",
    });

    expect(res.data?.note.id).toBe("note_mock_0001");
  });

  it("ignores an overlay with an invalid shape", async () => {
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify({ version: 1, sequence: "many", notes: {} }),
    });
    const res = await new MockCrmDataProvider({ clock, storage }).addNote(ctx(), {
      userId: USER_ID,
      body: "A",
      idempotencyKey: "k1",
    });

    expect(res.data?.note.id).toBe("note_mock_0001");
  });
});

describe("addNote — storage write failure", () => {
  it("returns internal instead of throwing, and reports nothing as created", async () => {
    const hostile: KeyValueStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("quota exceeded");
      },
      removeItem() {},
    };
    const provider = new MockCrmDataProvider({ clock, storage: hostile });
    const res = await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });

    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("internal");
    expect(res.error?.retriable).toBe(true);
    expect(res.data).toBeNull();
  });

  it("leaves the previous overlay intact when the write fails", async () => {
    const backing = new MemoryKeyValueStorage();
    let failing = false;
    const flaky: KeyValueStorage = {
      getItem: (k) => backing.getItem(k),
      setItem: (k, v) => {
        if (failing) throw new Error("quota exceeded");
        backing.setItem(k, v);
      },
      removeItem: (k) => backing.removeItem(k),
    };
    const provider = new MockCrmDataProvider({ clock, storage: flaky });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Сохранено", idempotencyKey: "k1" });

    failing = true;
    await provider.addNote(ctx(), { userId: USER_ID, body: "Потеряно", idempotencyKey: "k2" });

    const overlay = overlayIn(backing);
    expect(overlay.notes).toHaveLength(1);
    expect(overlay.notes[0]!.body).toBe("Сохранено");
    expect(overlay.sequence).toBe(1);
  });
});

describe("addNote — fixtures stay immutable", () => {
  it("does not mutate the fixture dataset", async () => {
    const before = JSON.stringify(defaultDataset(clock));
    const { provider } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });

    expect(JSON.stringify(defaultDataset(clock))).toBe(before);
  });

  it("does not change what a read of the user returns", async () => {
    const { provider } = setup();
    const before = await provider.getUserById(ctx(), { userId: USER_ID });
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });
    const after = await provider.getUserById(ctx(), { userId: USER_ID });

    expect(after).toEqual(before);
  });

  it("keeps authored notes out of the fixture-generated note", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Авторская", idempotencyKey: "k1" });

    // The overlay holds only the authored note; the synthetic one is regenerated.
    const overlay = new MutationOverlayStore(storage).read();
    expect(overlay.notes).toHaveLength(1);
    expect(overlay.notes[0]!.id).toBe("note_mock_0001");
  });
});

describe("AuditRecord content", () => {
  it("records the fact, never the note body", async () => {
    const { provider, storage } = setup();
    const body = "ТЕЛО-КОТОРОЕ-НЕ-ДОЛЖНО-ПОПАСТЬ-В-AUDIT";
    const res = await provider.addNote(ctx("support", "emp_s1"), {
      userId: USER_ID,
      body,
      idempotencyKey: "k1",
    });

    expect(JSON.stringify(res.data?.audit)).not.toContain(body);
    expect(JSON.stringify(overlayIn(storage).auditRecords)).not.toContain(body);
    expect(JSON.stringify(overlayIn(storage).auditRecords)).not.toContain("ТЕЛО-КОТОРОЕ");
  });

  it("has exactly the documented fields and a closed reason code", async () => {
    const { provider } = setup();
    const res = await provider.addNote(ctx("support", "emp_s1"), {
      userId: USER_ID,
      body: "Т",
      idempotencyKey: "k1",
    });

    expect(res.data?.audit).toEqual({
      id: "audit_mock_0001",
      action: "note_added",
      actorEmployeeId: "emp_s1",
      actorRole: "support",
      targetUserId: USER_ID,
      entityType: "note",
      entityId: "note_mock_0001",
      at: res.data?.note.createdAt,
      reasonCode: "note_added_by_employee",
      mock: true,
    });
  });

  it("carries no email, phone or financial value", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Т", idempotencyKey: "k1" });

    const serialized = JSON.stringify(overlayIn(storage).auditRecords);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/\$/);
    expect(serialized).not.toMatch(/\+\d{6,}/);
  });
});

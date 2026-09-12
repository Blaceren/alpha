/**
 * assignPrimaryOwner (Phase 1B4-C).
 *
 * Validation, permissions across all 10 roles, unassign, idempotency, expectedOwnerId
 * concurrency, audit contents, fixture immutability. Storage is always injected: no
 * test touches a real localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  parseOverlay,
  PRIMARY_OWNER_RECEIPT_KIND,
} from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@/data/contracts/CrmMutations";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();

/** A user who starts out owned, and one who starts out unassigned. */
const OWNED = defaultDataset(clock).find((u) => u.operations.primaryOwnerId !== null)!;
const UNOWNED = defaultDataset(clock).find((u) => u.operations.primaryOwnerId === null)!;
const USER_ID = OWNED.identity.userId;
const BASELINE_OWNER = OWNED.operations.primaryOwnerId!;
const OTHER_USER_ID = defaultDataset(clock).filter((u) => u.identity.userId !== USER_ID)[0]!.identity.userId;
const MISSING_USER_ID = "u_does_not_exist";

/** ROLE_PERMISSION_MATRIX §5 "Назначить owner" — unchanged by this phase. */
const ALLOWED: readonly CrmRole[] = ["crm_admin", "crm_manager", "retention_manager"];
const DENIED: readonly CrmRole[] = [
  "mentor",
  "support",
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

/** The command that assigns OWNED to a different candidate. */
function assign(overrides: Partial<Parameters<MockCrmDataProvider["assignPrimaryOwner"]>[1]> = {}) {
  return {
    userId: USER_ID,
    ownerId: "emp_ret2",
    expectedOwnerId: BASELINE_OWNER,
    idempotencyKey: "k1",
    ...overrides,
  };
}

describe("assignPrimaryOwner — success", () => {
  it("assigns a new owner and writes exactly one audit record", async () => {
    const { provider, storage } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), assign());

    expect(res.status).toBe("ok");
    expect(res.error).toBeNull();
    expect(res.data?.replayed).toBe(false);
    expect(res.data?.ownerId).toBe("emp_ret2");
    expect(res.data?.userId).toBe(USER_ID);

    const overlay = overlayIn(storage);
    expect(overlay.auditRecords).toHaveLength(1);
    expect(overlay.idempotencyReceipts).toHaveLength(1);
    // No note was created — the mutations do not bleed into each other.
    expect(overlay.notes).toHaveLength(0);
  });

  it("takes the actor from ctx, not from the command", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx("retention_manager", "emp_ret_9"), {
      ...assign(),
      // Extra keys are not part of the command type and must not reach the record.
      actorEmployeeId: "emp_someone_else",
      actorRole: "crm_admin",
    } as never);

    expect(res.data?.audit.actorEmployeeId).toBe("emp_ret_9");
    expect(res.data?.audit.actorRole).toBe("retention_manager");
  });

  it("the new owner is visible on the next read", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());
    const view = await provider.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBe("emp_ret2");
  });

  it("survives a new provider over the same storage", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());

    const reborn = new MockCrmDataProvider({ clock, storage });
    const view = await reborn.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBe("emp_ret2");
  });

  it("the latest of several changes wins", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: "emp_ret2", idempotencyKey: "k1" }));
    await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_men1", expectedOwnerId: "emp_ret2", idempotencyKey: "k2" }),
    );
    await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_mgr", expectedOwnerId: "emp_men1", idempotencyKey: "k3" }),
    );

    const view = await provider.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBe("emp_mgr");
  });

  it("keeps the full history — the audit log IS the history (D-08)", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: "emp_ret2", idempotencyKey: "k1" }));
    await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_men1", expectedOwnerId: "emp_ret2", idempotencyKey: "k2" }),
    );

    const records = overlayIn(storage).auditRecords.filter((a) => a.action === "primary_owner_changed");
    expect(records).toHaveLength(2);
    expect(records.map((r) => [r.previousOwnerId, r.nextOwnerId])).toEqual([
      [BASELINE_OWNER, "emp_ret2"],
      ["emp_ret2", "emp_men1"],
    ]);
  });
});

describe("assignPrimaryOwner — unassign", () => {
  it("clears the owner with ownerId: null", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), assign({ ownerId: null }));

    expect(res.status).toBe("ok");
    expect(res.data?.ownerId).toBeNull();

    const view = await provider.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBeNull();
  });

  it("records the clear as previous → null, not as a missing field", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: null }));

    const record = overlayIn(storage).auditRecords[0]!;
    expect(record.action).toBe("primary_owner_changed");
    if (record.action !== "primary_owner_changed") throw new Error("unreachable");
    expect(record.previousOwnerId).toBe(BASELINE_OWNER);
    expect(record.nextOwnerId).toBeNull();
    expect("nextOwnerId" in record).toBe(true);
  });

  it("assigns an owner to a user who started with none", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), {
      userId: UNOWNED.identity.userId,
      ownerId: "emp_ret1",
      expectedOwnerId: null,
      idempotencyKey: "k1",
    });

    expect(res.status).toBe("ok");
    const view = await provider.getUser360(ctx(), { userId: UNOWNED.identity.userId });
    expect(view.data?.owner.ownerId).toBe("emp_ret1");
  });

  it("unassign is a different command from assign — same key conflicts", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: "emp_ret2", idempotencyKey: "k1" }));
    const res = await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: null, expectedOwnerId: "emp_ret2", idempotencyKey: "k1" }),
    );
    expect(res.error?.code).toBe("conflict");
  });
});

describe("assignPrimaryOwner — validation", () => {
  it.each([
    ["an empty key", { idempotencyKey: "" }],
    ["a whitespace key", { idempotencyKey: "   " }],
    ["an over-long key", { idempotencyKey: "k".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1) }],
  ])("refuses %s with invalid_input", async (_label, overrides) => {
    const { provider, storage } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), assign(overrides));
    expect(res.error?.code).toBe("invalid_input");
    expect(res.error?.retriable).toBe(false);
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });

  it("trims the key, so `  k1  ` and `k1` are the same command", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "k1" }));
    const res = await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "  k1  " }));

    expect(res.status).toBe("ok");
    expect(res.data?.replayed).toBe(true);
    expect(overlayIn(storage).auditRecords).toHaveLength(1);
  });

  it.each([
    ["an employee who is not a candidate", "emp_mod1"],
    ["the demo session actor", "emp_mock_admin"],
    ["an id that does not exist", "emp_nobody"],
    ["an empty string", ""],
  ])("refuses %s as an owner", async (_label, ownerId) => {
    const { provider, storage } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), assign({ ownerId }));
    expect(res.error?.code).toBe("invalid_input");
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });

  it("accepts every candidate the directory offers", async () => {
    for (const candidate of ["emp_ret1", "emp_ret2", "emp_men1", "emp_mgr", "emp_sup1"]) {
      const { provider } = setup();
      const res = await provider.assignPrimaryOwner(ctx(), assign({ ownerId: candidate }));
      expect(res.status).toBe("ok");
    }
  });

  it("returns not_found for an unknown user and writes nothing", async () => {
    const { provider, storage } = setup();
    const res = await provider.assignPrimaryOwner(
      ctx(),
      assign({ userId: MISSING_USER_ID, expectedOwnerId: null }),
    );
    expect(res.error?.code).toBe("not_found");
    expect(res.error?.retriable).toBe(false);
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
  });

  it("validates input before looking the user up — order matches addNote", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(
      ctx(),
      assign({ userId: MISSING_USER_ID, idempotencyKey: "" }),
    );
    expect(res.error?.code).toBe("invalid_input");
  });
});

describe("assignPrimaryOwner — permissions", () => {
  it.each(ALLOWED)("%s may assign", async (role) => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx(role), assign());
    expect(res.status).toBe("ok");
  });

  it.each(DENIED)("%s may not assign, and nothing is written", async (role) => {
    const { provider, storage } = setup();
    const res = await provider.assignPrimaryOwner(ctx(role), assign());

    expect(res.error?.code).toBe("unauthorized");
    expect(res.error?.retriable).toBe(false);
    expect(overlayIn(storage).auditRecords).toHaveLength(0);
    expect(overlayIn(storage).idempotencyReceipts).toHaveLength(0);
    expect(overlayIn(storage).sequence).toBe(0);
  });

  it("covers every role in CRM_ROLES — a new role cannot be forgotten", () => {
    expect([...ALLOWED, ...DENIED].sort()).toEqual([...CRM_ROLES].sort());
  });

  it("support keeps addNote and still may not assign — Edit ≠ Assign (D-53)", async () => {
    const { provider } = setup();

    const note = await provider.addNote(ctx("support"), {
      userId: USER_ID,
      body: "Support пишет заметку",
      idempotencyKey: "note-key",
    });
    expect(note.status).toBe("ok");

    const owner = await provider.assignPrimaryOwner(ctx("support"), assign());
    expect(owner.error?.code).toBe("unauthorized");
  });
});

describe("assignPrimaryOwner — candidates read", () => {
  it.each(ALLOWED)("%s gets the candidate list", async (role) => {
    const { provider } = setup();
    const res = await provider.getPrimaryOwnerCandidates(ctx(role));
    expect(res.status).toBe("ok");
    expect(res.data?.map((c) => c.employeeId).sort()).toEqual([
      "emp_men1",
      "emp_mgr",
      "emp_ret1",
      "emp_ret2",
      "emp_sup1",
    ]);
  });

  it.each(DENIED)("%s is refused, not handed an empty list", async (role) => {
    const { provider } = setup();
    const res = await provider.getPrimaryOwnerCandidates(ctx(role));
    expect(res.error?.code).toBe("unauthorized");
    expect(res.data).toBeNull();
  });

  it("returns only id and display name — no role, email, team or workload", async () => {
    const { provider } = setup();
    const res = await provider.getPrimaryOwnerCandidates(ctx());
    for (const c of res.data!) {
      expect(Object.keys(c).sort()).toEqual(["displayName", "employeeId"]);
    }
    expect(JSON.stringify(res.data)).not.toMatch(/@/);
  });
});

describe("assignPrimaryOwner — idempotency", () => {
  it("replays the same command under the same key without a second audit", async () => {
    const { provider, storage } = setup();
    const first = await provider.assignPrimaryOwner(ctx(), assign());
    const second = await provider.assignPrimaryOwner(ctx(), assign());

    expect(second.status).toBe("ok");
    expect(second.data?.replayed).toBe(true);
    expect(second.data?.audit.id).toBe(first.data?.audit.id);
    expect(second.data?.ownerId).toBe("emp_ret2");
    expect(overlayIn(storage).auditRecords).toHaveLength(1);
  });

  /**
   * The reason `expectedOwnerId` is not in the fingerprint and the replay check runs
   * before the precondition: after a success the current owner IS what the command
   * assigned, so the original `expectedOwnerId` is now stale. Were the precondition
   * checked first, every safe retry of a successful write would report `conflict`.
   */
  it("replays even though expectedOwnerId is now stale", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());
    // Current owner is emp_ret2; the command still says it expected BASELINE_OWNER.
    const retry = await provider.assignPrimaryOwner(ctx(), assign());

    expect(retry.status).toBe("ok");
    expect(retry.data?.replayed).toBe(true);
    expect(retry.error).toBeNull();
  });

  it.each([
    ["a different user", { userId: OTHER_USER_ID, expectedOwnerId: null }],
    ["a different owner", { ownerId: "emp_men1" }],
  ])("conflicts on the same key with %s", async (_label, overrides) => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());
    const res = await provider.assignPrimaryOwner(ctx(), assign(overrides));

    expect(res.error?.code).toBe("conflict");
    expect(overlayIn(storage).auditRecords).toHaveLength(1);
  });

  it.each([
    ["a different actorId", ctx("crm_admin", "emp_someone_else")],
    ["a different role", ctx("crm_manager", "emp_actor_1")],
  ])("conflicts on the same key with %s", async (_label, otherCtx) => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());
    const res = await provider.assignPrimaryOwner(otherCtx, assign());
    expect(res.error?.code).toBe("conflict");
  });

  it("a key spent on a note is spent — assign under it conflicts", async () => {
    const { provider } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Заметка", idempotencyKey: "shared" });
    const res = await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "shared" }));
    expect(res.error?.code).toBe("conflict");
  });

  it("a key spent on an assign is spent — a note under it conflicts", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "shared" }));
    const res = await provider.addNote(ctx(), {
      userId: USER_ID,
      body: "Заметка",
      idempotencyKey: "shared",
    });
    expect(res.error?.code).toBe("conflict");
  });

  it("writes an owner receipt with its discriminant", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());

    const receipt = overlayIn(storage).idempotencyReceipts[0]!;
    expect(receipt.kind).toBe(PRIMARY_OWNER_RECEIPT_KIND);
    expect(receipt.key).toBe("k1");
    // No noteId on an owner receipt — the shared type is not note-shaped.
    expect("noteId" in receipt).toBe(false);
  });

  it("a storage failure does not burn the key — the same key retries cleanly", async () => {
    const failing = new MemoryKeyValueStorage();
    let broken = true;
    const original = failing.setItem.bind(failing);
    failing.setItem = (k: string, v: string) => {
      if (broken) throw new Error("quota");
      original(k, v);
    };

    const provider = new MockCrmDataProvider({ clock, storage: failing });
    const first = await provider.assignPrimaryOwner(ctx(), assign());
    expect(first.error?.code).toBe("internal");
    expect(first.error?.retriable).toBe(true);

    broken = false;
    const retry = await provider.assignPrimaryOwner(ctx(), assign());
    expect(retry.status).toBe("ok");
    expect(retry.data?.replayed).toBe(false);
  });
});

describe("assignPrimaryOwner — expectedOwnerId concurrency", () => {
  it("refuses when the owner moved under the caller", async () => {
    const { provider, storage } = setup();
    // Someone else assigns first.
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: "emp_men1", idempotencyKey: "first" }));
    const before = overlayIn(storage);

    // Our command still believes the baseline owner is current.
    const res = await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_ret2", expectedOwnerId: BASELINE_OWNER, idempotencyKey: "second" }),
    );

    expect(res.error?.code).toBe("conflict");
    expect(res.error?.retriable).toBe(false);
    expect(res.data).toBeNull();

    // Nothing written, and the winner still holds the user.
    const after = overlayIn(storage);
    expect(after).toEqual(before);
    const view = await provider.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBe("emp_men1");
  });

  it("refuses a stale `null` expectation after someone assigned", async () => {
    const { provider } = setup();
    const id = UNOWNED.identity.userId;
    await provider.assignPrimaryOwner(ctx(), {
      userId: id,
      ownerId: "emp_ret1",
      expectedOwnerId: null,
      idempotencyKey: "first",
    });

    const res = await provider.assignPrimaryOwner(ctx(), {
      userId: id,
      ownerId: "emp_ret2",
      expectedOwnerId: null,
      idempotencyKey: "second",
    });
    expect(res.error?.code).toBe("conflict");
  });

  it("refuses a stale non-null expectation after someone unassigned", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: null, idempotencyKey: "first" }));

    const res = await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_ret2", expectedOwnerId: BASELINE_OWNER, idempotencyKey: "second" }),
    );
    expect(res.error?.code).toBe("conflict");
  });

  it("accepts when the expectation matches the baseline fixture owner", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx(), assign({ expectedOwnerId: BASELINE_OWNER }));
    expect(res.status).toBe("ok");
  });

  it("compares against the EFFECTIVE owner, not the fixture", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: "emp_men1", idempotencyKey: "first" }));

    // Expecting the effective owner (emp_men1) works; expecting the fixture does not.
    const good = await provider.assignPrimaryOwner(
      ctx(),
      assign({ ownerId: "emp_ret2", expectedOwnerId: "emp_men1", idempotencyKey: "second" }),
    );
    expect(good.status).toBe("ok");
  });
});

describe("assignPrimaryOwner — audit contents", () => {
  it("has exactly the documented fields and a closed reason code", async () => {
    const { provider } = setup();
    const res = await provider.assignPrimaryOwner(ctx("retention_manager", "emp_r1"), assign());

    expect(res.data?.audit).toEqual({
      id: "audit_mock_0001",
      action: "primary_owner_changed",
      actorEmployeeId: "emp_r1",
      actorRole: "retention_manager",
      targetUserId: USER_ID,
      entityType: "user",
      entityId: USER_ID,
      at: res.data?.audit.at,
      reasonCode: "primary_owner_changed_by_employee",
      previousOwnerId: BASELINE_OWNER,
      nextOwnerId: "emp_ret2",
      mock: true,
    });
  });

  it("carries no email, phone, financial value, free text or idempotency key", async () => {
    const { provider, storage } = setup();
    await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "SECRET-KEY-VALUE" }));

    const serialized = JSON.stringify(overlayIn(storage).auditRecords);
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/\$/);
    expect(serialized).not.toMatch(/\+\d{6,}/);
    expect(serialized).not.toContain("SECRET-KEY-VALUE");
    // No user-facing name of the user, and no display label of the employee.
    expect(serialized).not.toContain(OWNED.identity.displayName);
    expect(serialized).not.toContain("Retention 2");
  });

  it("ids are deterministic and the sequence is shared with notes", async () => {
    const { provider, storage } = setup();
    await provider.addNote(ctx(), { userId: USER_ID, body: "Заметка", idempotencyKey: "n1" });
    await provider.assignPrimaryOwner(ctx(), assign({ idempotencyKey: "o1" }));

    const overlay = overlayIn(storage);
    expect(overlay.auditRecords.map((a) => a.id)).toEqual(["audit_mock_0001", "audit_mock_0002"]);
    expect(overlay.sequence).toBe(2);
  });
});

describe("assignPrimaryOwner — fixtures stay immutable", () => {
  it("the dataset is byte-identical before and after", async () => {
    const before = JSON.stringify(defaultDataset(clock));
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());
    await provider.assignPrimaryOwner(ctx(), assign({ ownerId: null, expectedOwnerId: "emp_ret2", idempotencyKey: "k2" }));
    expect(JSON.stringify(defaultDataset(clock))).toBe(before);
  });

  /**
   * `defaultDataset` memoizes one array per FixedMockClock, so every provider shares
   * the same MockUser objects. An in-place write would surface in a provider that
   * never saw the command — including one built for a different demo state.
   */
  it("an assignment through one provider does not mutate another's dataset", async () => {
    const { provider } = setup();
    await provider.assignPrimaryOwner(ctx(), assign());

    const untouched = new MockCrmDataProvider({ clock, storage: new MemoryKeyValueStorage() });
    const view = await untouched.getUser360(ctx(), { userId: USER_ID });
    expect(view.data?.owner.ownerId).toBe(BASELINE_OWNER);
  });
});

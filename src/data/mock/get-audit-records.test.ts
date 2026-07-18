/**
 * getAuditRecords — the global Audit Workspace read (Phase 1B5-B).
 *
 * Every record here is created through the REAL mutation path (addNote,
 * assignPrimaryOwner, setNotePinned, updateNoteBody), so the read is proven over
 * production data, not a hand-written overlay. Permission across all nine roles,
 * ordering, pagination, fresh-provider persistence, corrupt overlay and storage
 * failure are all covered. Storage is always injected — no test touches a real
 * localStorage.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "./MockCrmDataProvider";
import { MUTATION_OVERLAY_STORAGE_KEY } from "./overlay/mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./overlay/storage";
import { CRM_ROLES, type CrmRole } from "@/domain/identity/roles";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "./fixtures/index";

const clock = new FixedMockClock();
const USER_ID = defaultDataset(clock)[0]!.identity.userId;
const USER_NAME = defaultDataset(clock)[0]!.identity.displayName;
const ACTOR = "emp_mock_admin"; // «Demo Operator» — the production mock session actor.

/** Roles that hold `view_audit` (ROLE_PERMISSION_MATRIX §1). */
const AUDIT_ROLES: readonly CrmRole[] = ["crm_admin", "crm_manager"];
const NO_AUDIT_ROLES: readonly CrmRole[] = CRM_ROLES.filter((r) => !AUDIT_ROLES.includes(r));

function ctx(role: CrmRole = "crm_admin", actorId = ACTOR): CrmContext {
  return { actorId, role, now: MOCK_NOW };
}

function setup(storage: KeyValueStorage = new MemoryKeyValueStorage()) {
  return { provider: new MockCrmDataProvider({ clock, storage }), storage };
}

/** Create exactly one record of each of the four actions, through the real path. */
async function seedAllFour(provider: MockCrmDataProvider) {
  const add = await provider.addNote(ctx(), {
    userId: USER_ID,
    body: "Первичная авторская заметка",
    idempotencyKey: "seed-add",
  });
  const noteId = add.data!.note.id;
  const updatedAt0 = add.data!.note.updatedAt;

  const current = await provider.getUserById(ctx(), { userId: USER_ID });
  const currentOwner = current.data?.ownerId ?? null;
  // Pick any candidate that is not the current owner.
  const nextOwner = currentOwner === "emp_ret1" ? "emp_men1" : "emp_ret1";
  await provider.assignPrimaryOwner(ctx(), {
    userId: USER_ID,
    ownerId: nextOwner,
    expectedOwnerId: currentOwner,
    idempotencyKey: "seed-owner",
  });

  await provider.setNotePinned(ctx(), {
    userId: USER_ID,
    noteId,
    pinned: true,
    expectedPinned: false,
    idempotencyKey: "seed-pin",
  });

  await provider.updateNoteBody(ctx(), {
    userId: USER_ID,
    noteId,
    body: "Переписанный текст заметки",
    expectedUpdatedAt: updatedAt0,
    idempotencyKey: "seed-body",
  });

  return { noteId };
}

describe("getAuditRecords — empty overlay", () => {
  it("returns an empty page for a permitted role", async () => {
    const { provider } = setup();
    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(res.status).toBe("empty");
    expect(res.error).toBeNull();
    expect(res.data?.items).toEqual([]);
    expect(res.data?.page.total).toBe(0);
  });
});

describe("getAuditRecords — populated overlay (all four actions)", () => {
  it("returns one view per action, newest first, with resolved names", async () => {
    const { provider } = setup();
    await seedAllFour(provider);

    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(res.status).toBe("ok");
    const items = res.data!.items;
    expect(items).toHaveLength(4);

    // Newest first: body → pin → owner → note_added.
    expect(items.map((i) => i.action)).toEqual([
      "note_body_changed",
      "note_pin_changed",
      "primary_owner_changed",
      "note_added",
    ]);

    // Names are resolved captions, not raw ids.
    for (const item of items) {
      expect(item.actorName).toBe("Demo Operator");
      expect(item.targetUserName).toBe(USER_NAME);
    }

    const pin = items.find((i) => i.action === "note_pin_changed")!;
    expect(pin).toMatchObject({ action: "note_pin_changed", pinned: true });

    const owner = items.find((i) => i.action === "primary_owner_changed")!;
    expect(owner).toMatchObject({
      action: "primary_owner_changed",
      previousOwnerName: expect.any(String),
      nextOwnerName: expect.any(String),
    });
    expect(res.data!.page.total).toBe(4);
  });

  it("puts no raw id, note body or reason code in the view", async () => {
    const { provider } = setup();
    await seedAllFour(provider);
    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    const serialized = JSON.stringify(res.data!.items);

    expect(serialized).not.toContain(ACTOR);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain("note_mock_");
    expect(serialized).not.toContain("Переписанный текст заметки"); // new body
    expect(serialized).not.toContain("Первичная авторская заметка"); // old body
    expect(serialized).not.toContain("_by_employee"); // reason codes
    expect(serialized).not.toContain("idempotencyKey");
  });
});

describe("getAuditRecords — pagination", () => {
  it("pages by 20, newest first, exposing nextCursor and total", async () => {
    const { provider } = setup();
    // 25 note_added records through the real mutation path.
    for (let i = 0; i < 25; i += 1) {
      await provider.addNote(ctx(), {
        userId: USER_ID,
        body: `Заметка №${i}`,
        idempotencyKey: `k-${i}`,
      });
    }

    const first = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(first.data!.items).toHaveLength(20);
    expect(first.data!.page.total).toBe(25);
    expect(first.data!.page.nextCursor).toBe("20");

    const second = await provider.getAuditRecords(ctx("crm_admin"), {
      page: { cursor: "20", pageSize: 20 },
    });
    expect(second.data!.items).toHaveLength(5);
    expect(second.data!.page.nextCursor).toBeNull();

    // No record id appears on both pages — the slices are disjoint.
    const firstIds = new Set(first.data!.items.map((i) => i.id));
    for (const item of second.data!.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });
});

describe("getAuditRecords — persistence across a fresh provider", () => {
  it("a new provider over the same storage reads the same records in the same order", async () => {
    const storage = new MemoryKeyValueStorage();
    const { provider } = setup(storage);
    await seedAllFour(provider);
    const first = await provider.getAuditRecords(ctx("crm_admin"), {});

    // A brand-new provider instance, same storage — the reload path.
    const reloaded = new MockCrmDataProvider({ clock, storage });
    const second = await reloaded.getAuditRecords(ctx("crm_admin"), {});

    expect(second.data!.items.map((i) => i.id)).toEqual(first.data!.items.map((i) => i.id));
  });
});

describe("getAuditRecords — corrupt overlay is fail-closed empty", () => {
  it("shows an empty page rather than partial or reconstructed records", async () => {
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: "{ this is not valid json",
    });
    const { provider } = setup(storage);
    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(res.status).toBe("empty");
    expect(res.data?.items).toEqual([]);
  });

  it("rejects a wrong-version overlay wholesale (no partial rows)", async () => {
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: JSON.stringify({
        version: 999,
        sequence: 1,
        notes: [],
        auditRecords: [{ id: "audit_mock_0001", action: "note_added" }],
        idempotencyReceipts: [],
      }),
    });
    const { provider } = setup(storage);
    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(res.status).toBe("empty");
    expect(res.data?.items).toEqual([]);
  });
});

describe("getAuditRecords — storage failure surfaces as a retriable error", () => {
  it("returns upstream_unavailable when the provider is in error mode", async () => {
    const provider = new MockCrmDataProvider({ clock, errorMode: true, storage: new MemoryKeyValueStorage() });
    const res = await provider.getAuditRecords(ctx("crm_admin"), {});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("upstream_unavailable");
    expect(res.error?.retriable).toBe(true);
    expect(res.data).toBeNull();
  });
});

describe("getAuditRecords — permission across all nine roles", () => {
  for (const role of AUDIT_ROLES) {
    it(`${role} receives records`, async () => {
      const { provider } = setup();
      await seedAllFour(provider);
      const res = await provider.getAuditRecords(ctx(role), {});
      expect(res.status).toBe("ok");
      expect(res.data!.items.length).toBeGreaterThan(0);
    });
  }

  for (const role of NO_AUDIT_ROLES) {
    it(`${role} is unauthorized and receives no data`, async () => {
      const { provider } = setup();
      await seedAllFour(provider);
      const res = await provider.getAuditRecords(ctx(role), {});
      expect(res.status).toBe("error");
      expect(res.error?.code).toBe("unauthorized");
      expect(res.data).toBeNull();
    });
  }

  it("refuses without reading the overlay — a corrupt overlay still yields unauthorized, not empty", async () => {
    // If the read happened before the permission check, a corrupt overlay would
    // degrade to `empty`; `unauthorized` proves the gate ran first.
    const storage = new MemoryKeyValueStorage({
      [MUTATION_OVERLAY_STORAGE_KEY]: "not-json-at-all",
    });
    const { provider } = setup(storage);
    const res = await provider.getAuditRecords(ctx("support"), {});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("unauthorized");
  });
});

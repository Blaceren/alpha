/**
 * Overlay backward compatibility (Phase 1B4-C).
 *
 * The overlay schema was widened in place — same key, same `version: 1` — to accept
 * owner audit records and owner receipts. Parsing is fail-closed on ANY malformed
 * row, rejecting the whole overlay, so a widening that got this wrong would not throw
 * or warn: it would quietly return an empty overlay and every note a user had written
 * would be gone on the next load.
 *
 * These tests build the 1B4-B overlay BY HAND — as a raw JSON string in exactly the
 * shape that phase wrote, not via the current writer — because a fixture produced by
 * today's code cannot prove yesterday's data still parses.
 */
import { describe, expect, it } from "vitest";
import { MockCrmDataProvider } from "../MockCrmDataProvider";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  parseOverlay,
  PRIMARY_OWNER_RECEIPT_KIND,
} from "./mutation-overlay";
import { MemoryKeyValueStorage } from "./storage";
import { FixedMockClock, MOCK_NOW } from "@/lib/clock";
import type { CrmContext } from "@/data/contracts/CrmDataProvider";
import { defaultDataset } from "../fixtures/index";

const clock = new FixedMockClock();
const USER_ID = defaultDataset(clock)[0]!.identity.userId;

const ctx: CrmContext = { actorId: "emp_actor_1", role: "crm_admin", now: MOCK_NOW };

/**
 * A Phase 1B4-B overlay, written out literally. Note the receipt has NO `kind`: that
 * field did not exist, and every overlay sitting in a real browser looks like this.
 */
const LEGACY_OVERLAY_JSON = JSON.stringify({
  version: 1,
  sequence: 2,
  notes: [
    {
      id: "note_mock_0001",
      userId: USER_ID,
      caseId: null,
      authorEmployeeId: "emp_mock_admin",
      body: "Заметка, написанная до обновления схемы",
      visibility: "team",
      pinned: false,
      createdAt: "2026-07-11T09:00:00.001Z",
      updatedAt: "2026-07-11T09:00:00.001Z",
      mock: true,
    },
    {
      id: "note_mock_0002",
      userId: USER_ID,
      caseId: null,
      authorEmployeeId: "emp_mock_admin",
      body: "Вторая заметка",
      visibility: "team",
      pinned: false,
      createdAt: "2026-07-11T09:00:00.002Z",
      updatedAt: "2026-07-11T09:00:00.002Z",
      mock: true,
    },
  ],
  auditRecords: [
    {
      id: "audit_mock_0001",
      action: "note_added",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-11T09:00:00.001Z",
      reasonCode: "note_added_by_employee",
      mock: true,
    },
    {
      id: "audit_mock_0002",
      action: "note_added",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      entityType: "note",
      entityId: "note_mock_0002",
      at: "2026-07-11T09:00:00.002Z",
      reasonCode: "note_added_by_employee",
      mock: true,
    },
  ],
  idempotencyReceipts: [
    { key: "legacy-key-1", fingerprint: "abcd1234abcd1234", noteId: "note_mock_0001", auditId: "audit_mock_0001" },
    { key: "legacy-key-2", fingerprint: "beef5678beef5678", noteId: "note_mock_0002", auditId: "audit_mock_0002" },
  ],
});

function seeded() {
  const storage = new MemoryKeyValueStorage();
  storage.setItem(MUTATION_OVERLAY_STORAGE_KEY, LEGACY_OVERLAY_JSON);
  return { storage, provider: new MockCrmDataProvider({ clock, storage }) };
}

function overlayIn(storage: MemoryKeyValueStorage) {
  return parseOverlay(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY));
}

describe("overlay v1 — a Phase 1B4-B overlay still parses", () => {
  it("keeps every note, audit record, receipt and the sequence", () => {
    const overlay = parseOverlay(LEGACY_OVERLAY_JSON);

    expect(overlay.notes).toHaveLength(2);
    expect(overlay.notes.map((n) => n.id)).toEqual(["note_mock_0001", "note_mock_0002"]);
    expect(overlay.notes[0]!.body).toBe("Заметка, написанная до обновления схемы");
    expect(overlay.auditRecords).toHaveLength(2);
    expect(overlay.idempotencyReceipts).toHaveLength(2);
    // The counter must survive, or the next mutation reissues ids over live data.
    expect(overlay.sequence).toBe(2);
  });

  it("accepts a legacy receipt in its original shape — no `kind` is not corruption", () => {
    const overlay = parseOverlay(LEGACY_OVERLAY_JSON);
    const receipt = overlay.idempotencyReceipts[0]!;

    expect(receipt.kind).toBeUndefined();
    expect(receipt.key).toBe("legacy-key-1");
    // Absence of the discriminant IS the note discriminant.
    expect(receipt.kind === PRIMARY_OWNER_RECEIPT_KIND).toBe(false);
  });

  it("the notes are still readable through the provider, not just the parser", async () => {
    const { provider } = seeded();
    const res = await provider.getUserNotes(ctx, { userId: USER_ID });

    const bodies = res.data!.items.map((n) => n.body);
    expect(bodies).toContain("Заметка, написанная до обновления схемы");
    expect(bodies).toContain("Вторая заметка");
  });
});

describe("overlay v1 — legacy notes and a new owner change coexist", () => {
  it("an owner mutation on a legacy overlay leaves every note intact", async () => {
    const { provider, storage } = seeded();
    const before = overlayIn(storage);

    const res = await provider.assignPrimaryOwner(ctx, {
      userId: USER_ID,
      ownerId: "emp_ret2",
      expectedOwnerId: before.notes.length ? defaultDataset(clock)[0]!.operations.primaryOwnerId : null,
      idempotencyKey: "owner-key-1",
    });
    expect(res.status).toBe("ok");

    const after = overlayIn(storage);

    // The notes are untouched, by value.
    expect(after.notes).toEqual(before.notes);
    // The legacy audit records are untouched and the owner record was appended.
    expect(after.auditRecords).toHaveLength(3);
    expect(after.auditRecords.slice(0, 2)).toEqual(before.auditRecords);
    expect(after.auditRecords[2]!.action).toBe("primary_owner_changed");
    // The legacy receipts are untouched and the owner receipt was appended.
    expect(after.idempotencyReceipts).toHaveLength(3);
    expect(after.idempotencyReceipts.slice(0, 2)).toEqual(before.idempotencyReceipts);
    expect(after.idempotencyReceipts[2]!.kind).toBe(PRIMARY_OWNER_RECEIPT_KIND);
    // The sequence continued from the legacy value rather than restarting.
    expect(after.sequence).toBe(3);
  });

  it("re-reading the mixed overlay returns both kinds — it round-trips", async () => {
    const { provider, storage } = seeded();
    await provider.assignPrimaryOwner(ctx, {
      userId: USER_ID,
      ownerId: "emp_ret2",
      expectedOwnerId: defaultDataset(clock)[0]!.operations.primaryOwnerId,
      idempotencyKey: "owner-key-1",
    });

    // Parse what was actually serialized, exactly as a page reload would.
    const reread = overlayIn(storage);
    expect(reread.notes).toHaveLength(2);
    expect(reread.auditRecords.filter((a) => a.action === "note_added")).toHaveLength(2);
    expect(reread.auditRecords.filter((a) => a.action === "primary_owner_changed")).toHaveLength(1);

    // And a fresh provider over the same storage still sees the notes AND the owner.
    const fresh = new MockCrmDataProvider({ clock, storage });
    const notes = await fresh.getUserNotes(ctx, { userId: USER_ID });
    expect(notes.data!.items.map((n) => n.body)).toContain("Вторая заметка");
    const view = await fresh.getUser360(ctx, { userId: USER_ID });
    expect(view.data!.owner.ownerId).toBe("emp_ret2");
  });
});

describe("overlay v1 — widening did not open a hole", () => {
  const legacy = () => JSON.parse(LEGACY_OVERLAY_JSON) as Record<string, unknown>;
  const withAudit = (record: unknown) => {
    const o = legacy();
    (o.auditRecords as unknown[]).push(record);
    return JSON.stringify(o);
  };
  const withReceipt = (receipt: unknown) => {
    const o = legacy();
    (o.idempotencyReceipts as unknown[]).push(receipt);
    return JSON.stringify(o);
  };

  const validOwnerAudit = {
    id: "audit_mock_0003",
    action: "primary_owner_changed",
    actorEmployeeId: "emp_mock_admin",
    actorRole: "crm_admin",
    targetUserId: USER_ID,
    entityType: "user",
    entityId: USER_ID,
    at: "2026-07-13T09:00:00.003Z",
    reasonCode: "primary_owner_changed_by_employee",
    previousOwnerId: "emp_ret1",
    nextOwnerId: null,
    mock: true,
  };

  it("accepts a well-formed owner audit record", () => {
    expect(parseOverlay(withAudit(validOwnerAudit)).auditRecords).toHaveLength(3);
  });

  it("accepts null on both sides — unassigned is a value, not missing data", () => {
    const record = { ...validOwnerAudit, previousOwnerId: null, nextOwnerId: null };
    expect(parseOverlay(withAudit(record)).auditRecords).toHaveLength(3);
  });

  it.each([
    ["an unknown action", { ...validOwnerAudit, action: "owner_deleted" }],
    ["a mismatched entity type", { ...validOwnerAudit, entityType: "note" }],
    ["an invented reason code", { ...validOwnerAudit, reasonCode: "because_i_said_so" }],
    ["a missing previousOwnerId", { ...validOwnerAudit, previousOwnerId: undefined }],
    ["a non-string nextOwnerId", { ...validOwnerAudit, nextOwnerId: 42 }],
    ["a lost mock marker", { ...validOwnerAudit, mock: false }],
    ["a note action carrying the wrong entity", { ...validOwnerAudit, action: "note_added" }],
  ])("fails closed on %s — the whole overlay, notes included", (_label, record) => {
    const overlay = parseOverlay(withAudit(record));
    expect(overlay.notes).toEqual([]);
    expect(overlay.auditRecords).toEqual([]);
    expect(overlay.sequence).toBe(0);
  });

  it.each([
    ["an unknown receipt kind", { kind: "something_else", key: "k", fingerprint: "f", auditId: "a" }],
    ["an owner receipt without auditId", { kind: PRIMARY_OWNER_RECEIPT_KIND, key: "k", fingerprint: "f" }],
    ["a note receipt without noteId", { key: "k", fingerprint: "f", auditId: "a" }],
    ["a receipt without a fingerprint", { key: "k", noteId: "n", auditId: "a" }],
  ])("fails closed on %s", (_label, receipt) => {
    const overlay = parseOverlay(withReceipt(receipt));
    expect(overlay.notes).toEqual([]);
    expect(overlay.idempotencyReceipts).toEqual([]);
  });

  it("still fails closed on an unknown schema version", () => {
    const o = legacy();
    o.version = 2;
    expect(parseOverlay(JSON.stringify(o)).notes).toEqual([]);
  });

  it("still fails closed on a corrupted note, exactly as before", () => {
    const o = legacy();
    (o.notes as Record<string, unknown>[])[0]!.visibility = "public";
    expect(parseOverlay(JSON.stringify(o)).notes).toEqual([]);
  });
});

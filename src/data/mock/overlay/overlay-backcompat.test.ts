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
  NOTE_BODY_RECEIPT_KIND,
  NOTE_DELETE_RECEIPT_KIND,
  NOTE_PIN_RECEIPT_KIND,
  NOTE_VISIBILITY_RECEIPT_KIND,
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

/* ---------------------------------------------------------------- Phase 1B4-D */

/**
 * A Phase 1B4-C overlay, written out literally: two notes, a note-add pair and an
 * OWNER change, plus the owner receipt with its `kind`. This is what a browser that
 * used owner assignment but never pinned a note holds.
 */
const OVERLAY_1B4C_JSON = JSON.stringify({
  version: 1,
  sequence: 3,
  notes: JSON.parse(LEGACY_OVERLAY_JSON).notes,
  auditRecords: [
    ...JSON.parse(LEGACY_OVERLAY_JSON).auditRecords,
    {
      id: "audit_mock_0003",
      action: "primary_owner_changed",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      entityType: "user",
      entityId: USER_ID,
      at: "2026-07-12T09:00:00.003Z",
      reasonCode: "primary_owner_changed_by_employee",
      previousOwnerId: "emp_ret1",
      nextOwnerId: "emp_ret2",
      mock: true,
    },
  ],
  idempotencyReceipts: [
    ...JSON.parse(LEGACY_OVERLAY_JSON).idempotencyReceipts,
    { kind: PRIMARY_OWNER_RECEIPT_KIND, key: "owner-legacy", fingerprint: "0000aaaa0000aaaa", auditId: "audit_mock_0003" },
  ],
});

const FIXTURE_NOTE_ID = `${USER_ID}_note_1`;

describe("overlay v1 — 1B4-B/1B4-C overlays survive a pin, and a pin coexists", () => {
  it("a pin on a 1B4-B (notes-only) overlay leaves every note, audit and receipt intact", async () => {
    const { provider, storage } = seeded();
    const before = overlayIn(storage);

    const res = await provider.setNotePinned(ctx, {
      userId: USER_ID,
      noteId: FIXTURE_NOTE_ID,
      pinned: true,
      expectedPinned: false,
      idempotencyKey: "pin-key-1",
    });
    expect(res.status).toBe("ok");

    const after = overlayIn(storage);
    // Notes are untouched, by value — pin state is not written onto them.
    expect(after.notes).toEqual(before.notes);
    // The legacy audit records are untouched and the pin record was appended.
    expect(after.auditRecords.slice(0, 2)).toEqual(before.auditRecords);
    expect(after.auditRecords.at(-1)!.action).toBe("note_pin_changed");
    // The legacy receipts are untouched and the pin receipt was appended.
    expect(after.idempotencyReceipts.slice(0, 2)).toEqual(before.idempotencyReceipts);
    expect(after.idempotencyReceipts.at(-1)!.kind).toBe(NOTE_PIN_RECEIPT_KIND);
    // The sequence continued from the legacy value rather than restarting.
    expect(after.sequence).toBe(3);
  });

  it("a 1B4-C overlay (notes + owner) parses and a pin coexists with the owner history", async () => {
    const storage = new MemoryKeyValueStorage();
    storage.setItem(MUTATION_OVERLAY_STORAGE_KEY, OVERLAY_1B4C_JSON);
    const provider = new MockCrmDataProvider({ clock, storage });

    // The owner record is readable before we touch anything.
    const owner0 = await provider.getUser360(ctx, { userId: USER_ID });
    expect(owner0.data!.owner.ownerId).toBe("emp_ret2");

    const res = await provider.setNotePinned(ctx, {
      userId: USER_ID,
      noteId: FIXTURE_NOTE_ID,
      pinned: true,
      expectedPinned: false,
      idempotencyKey: "pin-key-2",
    });
    expect(res.status).toBe("ok");

    // A fresh provider over the same storage still sees notes, the owner AND the pin.
    const fresh = new MockCrmDataProvider({ clock, storage });
    const notes = await fresh.getUserNotes(ctx, { userId: USER_ID });
    expect(notes.data!.items.map((n) => n.body)).toContain("Вторая заметка");
    expect(notes.data!.items.find((n) => n.id === FIXTURE_NOTE_ID)!.pinned).toBe(true);
    const owner = await fresh.getUser360(ctx, { userId: USER_ID });
    expect(owner.data!.owner.ownerId).toBe("emp_ret2");

    const reread = overlayIn(storage);
    expect(reread.auditRecords.filter((a) => a.action === "note_added")).toHaveLength(2);
    expect(reread.auditRecords.filter((a) => a.action === "primary_owner_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_pin_changed")).toHaveLength(1);
  });
});

describe("overlay v1 — the pin widening did not open a hole", () => {
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

  const validPinAudit = {
    id: "audit_mock_0003",
    action: "note_pin_changed",
    actorEmployeeId: "emp_mock_admin",
    actorRole: "crm_admin",
    targetUserId: USER_ID,
    entityType: "note",
    entityId: "note_mock_0001",
    at: "2026-07-13T09:00:00.003Z",
    reasonCode: "note_pin_changed_by_employee",
    previousPinned: false,
    nextPinned: true,
    mock: true,
  };

  it("accepts a well-formed pin audit record", () => {
    expect(parseOverlay(withAudit(validPinAudit)).auditRecords).toHaveLength(3);
  });

  it("accepts a well-formed pin receipt", () => {
    const receipt = { kind: NOTE_PIN_RECEIPT_KIND, key: "k", fingerprint: "f", auditId: "audit_mock_0003" };
    expect(parseOverlay(withReceipt(receipt)).idempotencyReceipts).toHaveLength(3);
  });

  it.each([
    ["a non-boolean previousPinned", { ...validPinAudit, previousPinned: "yes" }],
    ["a missing nextPinned", { ...validPinAudit, nextPinned: undefined }],
    ["a mismatched entity type", { ...validPinAudit, entityType: "user" }],
    ["an invented reason code", { ...validPinAudit, reasonCode: "because" }],
    ["a lost mock marker", { ...validPinAudit, mock: false }],
  ])("fails closed on %s — the whole overlay, notes included", (_label, record) => {
    const overlay = parseOverlay(withAudit(record));
    expect(overlay.notes).toEqual([]);
    expect(overlay.auditRecords).toEqual([]);
    expect(overlay.sequence).toBe(0);
  });

  it("fails closed on a pin receipt without an auditId", () => {
    const receipt = { kind: NOTE_PIN_RECEIPT_KIND, key: "k", fingerprint: "f" };
    const overlay = parseOverlay(withReceipt(receipt));
    expect(overlay.notes).toEqual([]);
    expect(overlay.idempotencyReceipts).toEqual([]);
  });
});

/* ---------------------------------------------------------------- Phase 1B4-E */

/** The legacy notes were authored by `emp_mock_admin`; only that actor may edit them. */
const ctxAuthor: CrmContext = { actorId: "emp_mock_admin", role: "crm_admin", now: MOCK_NOW };

/**
 * A Phase 1B4-D overlay written out literally: two notes, a note-add pair, an OWNER
 * change AND a PIN change, with the owner and pin receipts carrying their `kind`.
 * This is what a browser that assigned an owner and pinned a note — but never edited
 * a body — holds. A body edit must slot in additively on top of all of it.
 */
const OVERLAY_1B4D_JSON = JSON.stringify({
  version: 1,
  sequence: 4,
  notes: JSON.parse(LEGACY_OVERLAY_JSON).notes,
  auditRecords: [
    ...JSON.parse(OVERLAY_1B4C_JSON).auditRecords,
    {
      id: "audit_mock_0004",
      action: "note_pin_changed",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T09:00:00.004Z",
      reasonCode: "note_pin_changed_by_employee",
      previousPinned: false,
      nextPinned: true,
      mock: true,
    },
  ],
  idempotencyReceipts: [
    ...JSON.parse(OVERLAY_1B4C_JSON).idempotencyReceipts,
    { kind: NOTE_PIN_RECEIPT_KIND, key: "pin-legacy", fingerprint: "1111bbbb1111bbbb", auditId: "audit_mock_0004" },
  ],
});

describe("overlay v1 — 1B4-B/1B4-C/1B4-D overlays survive a body edit, and it coexists", () => {
  it("a body edit on a 1B4-B (notes-only) overlay preserves every other note, audit and receipt", async () => {
    const { provider, storage } = seeded();
    const before = overlayIn(storage);

    const res = await provider.updateNoteBody(ctxAuthor, {
      userId: USER_ID,
      noteId: "note_mock_0001",
      body: "Изменённое тело первой заметки",
      expectedUpdatedAt: "2026-07-11T09:00:00.001Z",
      idempotencyKey: "edit-key-1",
    });
    expect(res.status).toBe("ok");

    const after = overlayIn(storage);
    // The edited note kept its identity; only body + updatedAt changed.
    const edited = after.notes.find((n) => n.id === "note_mock_0001")!;
    expect(edited.body).toBe("Изменённое тело первой заметки");
    expect(edited.createdAt).toBe(before.notes[0]!.createdAt);
    expect(edited.authorEmployeeId).toBe(before.notes[0]!.authorEmployeeId);
    // The OTHER note is byte-identical.
    expect(after.notes.find((n) => n.id === "note_mock_0002")).toEqual(before.notes[1]);
    // Legacy audit records are untouched; the body record was appended.
    expect(after.auditRecords.slice(0, 2)).toEqual(before.auditRecords);
    expect(after.auditRecords.at(-1)!.action).toBe("note_body_changed");
    // Legacy receipts are untouched; the body receipt was appended.
    expect(after.idempotencyReceipts.slice(0, 2)).toEqual(before.idempotencyReceipts);
    expect(after.idempotencyReceipts.at(-1)!.kind).toBe(NOTE_BODY_RECEIPT_KIND);
    // The sequence continued from the legacy value.
    expect(after.sequence).toBe(3);
  });

  it("old notes, owner records, pin records and a new body-edit record all coexist", async () => {
    const storage = new MemoryKeyValueStorage();
    storage.setItem(MUTATION_OVERLAY_STORAGE_KEY, OVERLAY_1B4D_JSON);
    const provider = new MockCrmDataProvider({ clock, storage });

    // The pin and owner history read correctly before we touch anything.
    const owner0 = await provider.getUser360(ctx, { userId: USER_ID });
    expect(owner0.data!.owner.ownerId).toBe("emp_ret2");
    const notes0 = await provider.getUserNotes(ctx, { userId: USER_ID });
    expect(notes0.data!.items.find((n) => n.id === "note_mock_0001")!.pinned).toBe(true);

    const res = await provider.updateNoteBody(ctxAuthor, {
      userId: USER_ID,
      noteId: "note_mock_0001",
      body: "Тело после апдейта схемы",
      expectedUpdatedAt: "2026-07-11T09:00:00.001Z",
      idempotencyKey: "edit-key-2",
    });
    expect(res.status).toBe("ok");

    // A fresh provider over the same storage still sees notes, owner, pin AND the edit.
    const fresh = new MockCrmDataProvider({ clock, storage });
    const notes = await fresh.getUserNotes(ctx, { userId: USER_ID });
    const edited = notes.data!.items.find((n) => n.id === "note_mock_0001")!;
    expect(edited.body).toBe("Тело после апдейта схемы");
    // The pin survived the body edit (pin state is audit-derived, not on the note).
    expect(edited.pinned).toBe(true);
    const owner = await fresh.getUser360(ctx, { userId: USER_ID });
    expect(owner.data!.owner.ownerId).toBe("emp_ret2");

    const reread = overlayIn(storage);
    expect(reread.auditRecords.filter((a) => a.action === "note_added")).toHaveLength(2);
    expect(reread.auditRecords.filter((a) => a.action === "primary_owner_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_pin_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_body_changed")).toHaveLength(1);
  });
});

describe("overlay v1 — the body-edit widening did not open a hole", () => {
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

  const validBodyAudit = {
    id: "audit_mock_0003",
    action: "note_body_changed",
    actorEmployeeId: "emp_mock_admin",
    actorRole: "crm_admin",
    targetUserId: USER_ID,
    entityType: "note",
    entityId: "note_mock_0001",
    at: "2026-07-14T09:00:00.003Z",
    reasonCode: "note_body_changed_by_employee",
    mock: true,
  };

  it("accepts a well-formed body audit record — base fields only", () => {
    expect(parseOverlay(withAudit(validBodyAudit)).auditRecords).toHaveLength(3);
  });

  it("accepts a well-formed body receipt", () => {
    const receipt = { kind: NOTE_BODY_RECEIPT_KIND, key: "k", fingerprint: "f", auditId: "audit_mock_0003" };
    expect(parseOverlay(withReceipt(receipt)).idempotencyReceipts).toHaveLength(3);
  });

  it.each([
    ["a mismatched entity type", { ...validBodyAudit, entityType: "user" }],
    ["an invented reason code", { ...validBodyAudit, reasonCode: "because" }],
    ["an unknown action", { ...validBodyAudit, action: "note_scribbled" }],
    ["a lost mock marker", { ...validBodyAudit, mock: false }],
  ])("fails closed on %s — the whole overlay, notes included", (_label, record) => {
    const overlay = parseOverlay(withAudit(record));
    expect(overlay.notes).toEqual([]);
    expect(overlay.auditRecords).toEqual([]);
    expect(overlay.sequence).toBe(0);
  });

  it("fails closed on a body receipt without an auditId", () => {
    const receipt = { kind: NOTE_BODY_RECEIPT_KIND, key: "k", fingerprint: "f" };
    const overlay = parseOverlay(withReceipt(receipt));
    expect(overlay.notes).toEqual([]);
    expect(overlay.idempotencyReceipts).toEqual([]);
  });
});

/* ---------------------------------------------------------------- Phase 1B5-C */

/**
 * A Phase 1B4-E overlay written out literally: two notes, a note-add pair, an owner
 * change, a pin change AND a body change, with every typed receipt. This is what a
 * browser that used every prior notes mutation holds. A visibility change must slot
 * in additively on top of all of it.
 */
const OVERLAY_1B4E_JSON = JSON.stringify({
  version: 1,
  sequence: 5,
  notes: JSON.parse(LEGACY_OVERLAY_JSON).notes,
  auditRecords: [
    ...JSON.parse(OVERLAY_1B4D_JSON).auditRecords,
    {
      id: "audit_mock_0005",
      action: "note_body_changed",
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T09:00:00.005Z",
      reasonCode: "note_body_changed_by_employee",
      mock: true,
    },
  ],
  idempotencyReceipts: [
    ...JSON.parse(OVERLAY_1B4D_JSON).idempotencyReceipts,
    { kind: NOTE_BODY_RECEIPT_KIND, key: "body-legacy", fingerprint: "2222cccc2222cccc", auditId: "audit_mock_0005" },
  ],
});

describe("overlay v1 — 1B4-B…1B4-E overlays survive a visibility change, and it coexists", () => {
  it("a visibility change on a 1B4-B (notes-only) overlay preserves every other note, audit and receipt", async () => {
    const { provider, storage } = seeded();
    const before = overlayIn(storage);

    const res = await provider.setNoteVisibility(ctxAuthor, {
      userId: USER_ID,
      noteId: "note_mock_0001",
      visibility: "private",
      expectedUpdatedAt: "2026-07-11T09:00:00.001Z",
      idempotencyKey: "vis-key-1",
    });
    expect(res.status).toBe("ok");

    const after = overlayIn(storage);
    // The changed note kept its identity; only visibility + updatedAt changed.
    const changed = after.notes.find((n) => n.id === "note_mock_0001")!;
    expect(changed.visibility).toBe("private");
    expect(changed.body).toBe(before.notes[0]!.body);
    expect(changed.createdAt).toBe(before.notes[0]!.createdAt);
    expect(changed.authorEmployeeId).toBe(before.notes[0]!.authorEmployeeId);
    // The OTHER note is byte-identical.
    expect(after.notes.find((n) => n.id === "note_mock_0002")).toEqual(before.notes[1]);
    // Legacy audit records untouched; the visibility record was appended.
    expect(after.auditRecords.slice(0, 2)).toEqual(before.auditRecords);
    expect(after.auditRecords.at(-1)!.action).toBe("note_visibility_changed");
    // Legacy receipts untouched; the visibility receipt was appended.
    expect(after.idempotencyReceipts.slice(0, 2)).toEqual(before.idempotencyReceipts);
    expect(after.idempotencyReceipts.at(-1)!.kind).toBe(NOTE_VISIBILITY_RECEIPT_KIND);
    expect(after.sequence).toBe(3);
  });

  it("notes, owner, pin, body AND a new visibility record all coexist and round-trip", async () => {
    const storage = new MemoryKeyValueStorage();
    storage.setItem(MUTATION_OVERLAY_STORAGE_KEY, OVERLAY_1B4E_JSON);
    const provider = new MockCrmDataProvider({ clock, storage });

    const res = await provider.setNoteVisibility(ctxAuthor, {
      userId: USER_ID,
      noteId: "note_mock_0001",
      visibility: "private",
      expectedUpdatedAt: "2026-07-11T09:00:00.001Z",
      idempotencyKey: "vis-key-2",
    });
    expect(res.status).toBe("ok");

    // A fresh provider over the same storage sees the private note as its author…
    const fresh = new MockCrmDataProvider({ clock, storage });
    const asAuthor = await fresh.getUserNotes(ctxAuthor, { userId: USER_ID });
    const changed = asAuthor.data!.items.find((n) => n.id === "note_mock_0001")!;
    expect(changed.visibility).toBe("private");
    expect(changed.pinned).toBe(true); // pin survived (audit-derived)
    // …but a DIFFERENT actor no longer sees it.
    const asOther = await fresh.getUserNotes(ctx, { userId: USER_ID });
    expect(asOther.data!.items.some((n) => n.id === "note_mock_0001")).toBe(false);

    const reread = overlayIn(storage);
    expect(reread.auditRecords.filter((a) => a.action === "note_added")).toHaveLength(2);
    expect(reread.auditRecords.filter((a) => a.action === "primary_owner_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_pin_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_body_changed")).toHaveLength(1);
    expect(reread.auditRecords.filter((a) => a.action === "note_visibility_changed")).toHaveLength(1);
  });
});

describe("overlay v1 — the visibility widening did not open a hole", () => {
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

  const validVisibilityAudit = {
    id: "audit_mock_0003",
    action: "note_visibility_changed",
    actorEmployeeId: "emp_mock_admin",
    actorRole: "crm_admin",
    targetUserId: USER_ID,
    entityType: "note",
    entityId: "note_mock_0001",
    at: "2026-07-15T09:00:00.003Z",
    reasonCode: "note_visibility_changed_by_employee",
    previousVisibility: "team",
    nextVisibility: "private",
    mock: true,
  };

  it("accepts a well-formed visibility audit record", () => {
    expect(parseOverlay(withAudit(validVisibilityAudit)).auditRecords).toHaveLength(3);
  });

  it("accepts a well-formed visibility receipt", () => {
    const receipt = { kind: NOTE_VISIBILITY_RECEIPT_KIND, key: "k", fingerprint: "f", auditId: "audit_mock_0003" };
    expect(parseOverlay(withReceipt(receipt)).idempotencyReceipts).toHaveLength(3);
  });

  it.each([
    ["a role_restricted previousVisibility", { ...validVisibilityAudit, previousVisibility: "role_restricted" }],
    ["a role_restricted nextVisibility", { ...validVisibilityAudit, nextVisibility: "role_restricted" }],
    ["an unknown visibility value", { ...validVisibilityAudit, nextVisibility: "public" }],
    ["a missing previousVisibility", { ...validVisibilityAudit, previousVisibility: undefined }],
    ["a mismatched entity type", { ...validVisibilityAudit, entityType: "user" }],
    ["an invented reason code", { ...validVisibilityAudit, reasonCode: "because" }],
    ["a lost mock marker", { ...validVisibilityAudit, mock: false }],
  ])("fails closed on %s — the whole overlay, notes included", (_label, record) => {
    const overlay = parseOverlay(withAudit(record));
    expect(overlay.notes).toEqual([]);
    expect(overlay.auditRecords).toEqual([]);
    expect(overlay.sequence).toBe(0);
  });

  it("fails closed on a visibility receipt without an auditId", () => {
    const receipt = { kind: NOTE_VISIBILITY_RECEIPT_KIND, key: "k", fingerprint: "f" };
    const overlay = parseOverlay(withReceipt(receipt));
    expect(overlay.notes).toEqual([]);
    expect(overlay.idempotencyReceipts).toEqual([]);
  });
});

describe("overlay v1 — 1B4-B…1B5-C overlays survive a delete, and it coexists (Phase 1B6)", () => {
  it("a delete on a legacy overlay removes only the target row and appends one record + receipt", async () => {
    const storage = new MemoryKeyValueStorage();
    // A legacy notes-only overlay with two authored notes by the same author.
    storage.setItem(
      MUTATION_OVERLAY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sequence: 2,
        notes: [
          {
            id: "note_mock_0001",
            userId: USER_ID,
            caseId: null,
            authorEmployeeId: "emp_actor_1",
            body: "Первая",
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
            authorEmployeeId: "emp_actor_1",
            body: "Вторая",
            visibility: "team",
            pinned: false,
            createdAt: "2026-07-11T09:00:00.002Z",
            updatedAt: "2026-07-11T09:00:00.002Z",
            mock: true,
          },
        ],
        auditRecords: [],
        idempotencyReceipts: [
          { key: "legacy", fingerprint: "aaaa1111aaaa1111", noteId: "note_mock_0001", auditId: "audit_legacy" },
        ],
      }),
    );
    const provider = new MockCrmDataProvider({ clock, storage });

    const res = await provider.deleteNote(ctx, {
      userId: USER_ID,
      noteId: "note_mock_0001",
      expectedUpdatedAt: "2026-07-11T09:00:00.001Z",
      idempotencyKey: "del-legacy",
    });
    expect(res.status).toBe("ok");

    const after = overlayIn(storage);
    // Only the target row was removed; the other note and the legacy receipt survive.
    expect(after.notes.map((n) => n.id)).toEqual(["note_mock_0002"]);
    expect(after.idempotencyReceipts.some((r) => r.key === "legacy")).toBe(true);
    expect(after.auditRecords.filter((a) => a.action === "note_deleted")).toHaveLength(1);
    expect(after.idempotencyReceipts.at(-1)!.kind).toBe(NOTE_DELETE_RECEIPT_KIND);
  });
});

describe("overlay v1 — the delete widening did not open a hole (Phase 1B6)", () => {
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

  const validDeleteAudit = {
    id: "audit_mock_0003",
    action: "note_deleted",
    actorEmployeeId: "emp_mock_admin",
    actorRole: "crm_admin",
    targetUserId: USER_ID,
    entityType: "note",
    entityId: "note_mock_0001",
    at: "2026-07-15T09:00:00.003Z",
    reasonCode: "note_deleted_by_employee",
    mock: true,
  };

  it("accepts a well-formed delete audit record — base fields only", () => {
    expect(parseOverlay(withAudit(validDeleteAudit)).auditRecords).toHaveLength(3);
  });

  it("accepts a well-formed delete receipt", () => {
    const receipt = { kind: NOTE_DELETE_RECEIPT_KIND, key: "k", fingerprint: "f", auditId: "audit_mock_0003" };
    expect(parseOverlay(withReceipt(receipt)).idempotencyReceipts).toHaveLength(3);
  });

  it.each([
    ["a mismatched entity type", { ...validDeleteAudit, entityType: "user" }],
    ["an invented reason code", { ...validDeleteAudit, reasonCode: "because" }],
    ["a lost mock marker", { ...validDeleteAudit, mock: false }],
  ])("fails closed on %s — the whole overlay, notes included", (_label, record) => {
    const overlay = parseOverlay(withAudit(record));
    expect(overlay.notes).toEqual([]);
    expect(overlay.auditRecords).toEqual([]);
    expect(overlay.sequence).toBe(0);
  });

  it("fails closed on a delete receipt without an auditId", () => {
    const receipt = { kind: NOTE_DELETE_RECEIPT_KIND, key: "k", fingerprint: "f" };
    const overlay = parseOverlay(withReceipt(receipt));
    expect(overlay.notes).toEqual([]);
    expect(overlay.idempotencyReceipts).toEqual([]);
  });

  it("lets all SIX audit actions coexist in one overlay", () => {
    const o = legacy();
    const base = {
      actorEmployeeId: "emp_mock_admin",
      actorRole: "crm_admin",
      targetUserId: USER_ID,
      mock: true,
    };
    (o.auditRecords as unknown[]).push(
      { ...base, id: "audit_a", action: "note_added", entityType: "note", entityId: "note_mock_0001", at: "2026-07-15T09:00:00.001Z", reasonCode: "note_added_by_employee" },
      { ...base, id: "audit_b", action: "primary_owner_changed", entityType: "user", entityId: USER_ID, at: "2026-07-15T09:00:00.002Z", reasonCode: "primary_owner_changed_by_employee", previousOwnerId: null, nextOwnerId: "emp_ret1" },
      { ...base, id: "audit_c", action: "note_pin_changed", entityType: "note", entityId: "note_mock_0001", at: "2026-07-15T09:00:00.003Z", reasonCode: "note_pin_changed_by_employee", previousPinned: false, nextPinned: true },
      { ...base, id: "audit_d", action: "note_body_changed", entityType: "note", entityId: "note_mock_0001", at: "2026-07-15T09:00:00.004Z", reasonCode: "note_body_changed_by_employee" },
      { ...base, id: "audit_e", action: "note_visibility_changed", entityType: "note", entityId: "note_mock_0001", at: "2026-07-15T09:00:00.005Z", reasonCode: "note_visibility_changed_by_employee", previousVisibility: "team", nextVisibility: "private" },
      { ...base, id: "audit_f", action: "note_deleted", entityType: "note", entityId: "note_mock_0001", at: "2026-07-15T09:00:00.006Z", reasonCode: "note_deleted_by_employee" },
    );
    const overlay = parseOverlay(JSON.stringify(o));
    const actions = overlay.auditRecords.map((a) => a.action);
    expect(actions).toContain("note_added");
    expect(actions).toContain("primary_owner_changed");
    expect(actions).toContain("note_pin_changed");
    expect(actions).toContain("note_body_changed");
    expect(actions).toContain("note_visibility_changed");
    expect(actions).toContain("note_deleted");
  });
});

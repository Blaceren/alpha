/**
 * Overlay schema, fail-closed parsing and adapter behavior (Phase 1B4-A).
 * Nothing here touches a real localStorage — storage is injected.
 */
import { describe, expect, it } from "vitest";
import {
  MUTATION_OVERLAY_STORAGE_KEY,
  MutationOverlayStore,
  emptyOverlay,
  parseOverlay,
  type MutationOverlay,
} from "./mutation-overlay";
import { MemoryKeyValueStorage, type KeyValueStorage } from "./storage";
import { fingerprintAddNote, stableFingerprint } from "./fingerprint";
import type { CrmNote } from "@/domain/notes/note";
import type { AuditRecord } from "@/domain/audit/audit";

const note: CrmNote = {
  id: "note_mock_0001",
  userId: "u_001",
  caseId: null,
  authorEmployeeId: "emp_admin",
  body: "Заметка",
  visibility: "team",
  pinned: false,
  createdAt: "2026-07-13T09:00:00.001Z",
  updatedAt: "2026-07-13T09:00:00.001Z",
  mock: true,
};

const audit: AuditRecord = {
  id: "audit_mock_0001",
  action: "note_added",
  actorEmployeeId: "emp_admin",
  actorRole: "crm_admin",
  targetUserId: "u_001",
  entityType: "note",
  entityId: "note_mock_0001",
  at: "2026-07-13T09:00:00.001Z",
  reasonCode: "note_added_by_employee",
  mock: true,
};

const populated: MutationOverlay = {
  version: 1,
  sequence: 1,
  notes: [note],
  auditRecords: [audit],
  idempotencyReceipts: [
    { key: "k1", fingerprint: "abc", noteId: note.id, auditId: audit.id },
  ],
};

function seeded(raw: string): MemoryKeyValueStorage {
  return new MemoryKeyValueStorage({ [MUTATION_OVERLAY_STORAGE_KEY]: raw });
}

describe("overlay storage key", () => {
  it("is the versioned mutation key, separate from the demo-state and role keys", () => {
    expect(MUTATION_OVERLAY_STORAGE_KEY).toBe("ata-crm.mutation-overlay.v1");
    expect(MUTATION_OVERLAY_STORAGE_KEY).not.toBe("ata-crm.mock-state.v1");
    expect(MUTATION_OVERLAY_STORAGE_KEY).not.toBe("ata-crm.mock-role.v1");
  });
});

describe("parseOverlay — fail-closed", () => {
  it("returns an empty overlay for absent storage", () => {
    expect(parseOverlay(null)).toEqual(emptyOverlay());
    expect(parseOverlay("")).toEqual(emptyOverlay());
  });

  it("returns an empty overlay for corrupt JSON", () => {
    expect(parseOverlay("{not json")).toEqual(emptyOverlay());
    expect(parseOverlay("[[[")).toEqual(emptyOverlay());
  });

  it("returns an empty overlay for a non-object payload", () => {
    expect(parseOverlay('"a string"')).toEqual(emptyOverlay());
    expect(parseOverlay("[]")).toEqual(emptyOverlay());
    expect(parseOverlay("null")).toEqual(emptyOverlay());
  });

  it("returns an empty overlay for an unknown version", () => {
    expect(parseOverlay(JSON.stringify({ ...populated, version: 2 }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, version: 0 }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, version: "1" }))).toEqual(emptyOverlay());
  });

  it("returns an empty overlay when the sequence is not a natural number", () => {
    expect(parseOverlay(JSON.stringify({ ...populated, sequence: -1 }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, sequence: 1.5 }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, sequence: "1" }))).toEqual(emptyOverlay());
  });

  it("returns an empty overlay for an invalid shape", () => {
    expect(parseOverlay(JSON.stringify({ ...populated, notes: "nope" }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, auditRecords: {} }))).toEqual(emptyOverlay());
    expect(parseOverlay(JSON.stringify({ ...populated, idempotencyReceipts: 5 }))).toEqual(emptyOverlay());
  });

  it("rejects the whole overlay when a single note is malformed", () => {
    const broken = { ...populated, notes: [note, { id: "x" }] };
    expect(parseOverlay(JSON.stringify(broken))).toEqual(emptyOverlay());
  });

  it("rejects a note with an unknown visibility rather than defaulting it", () => {
    const broken = { ...populated, notes: [{ ...note, visibility: "everyone" }] };
    expect(parseOverlay(JSON.stringify(broken))).toEqual(emptyOverlay());
  });

  it("rejects records that lost their mock marker", () => {
    expect(parseOverlay(JSON.stringify({ ...populated, notes: [{ ...note, mock: false }] }))).toEqual(
      emptyOverlay(),
    );
    expect(
      parseOverlay(JSON.stringify({ ...populated, auditRecords: [{ ...audit, mock: false }] })),
    ).toEqual(emptyOverlay());
  });

  it("accepts a well-formed overlay unchanged", () => {
    expect(parseOverlay(JSON.stringify(populated))).toEqual(populated);
  });

  it("accepts private and role_restricted notes — the enum members still exist", () => {
    const raw = {
      ...populated,
      notes: [
        { ...note, id: "n_p", visibility: "private" },
        { ...note, id: "n_r", visibility: "role_restricted" },
      ],
    };
    expect(parseOverlay(JSON.stringify(raw)).notes).toHaveLength(2);
  });
});

describe("MutationOverlayStore", () => {
  it("reads an empty overlay from empty storage", () => {
    expect(new MutationOverlayStore(new MemoryKeyValueStorage()).read()).toEqual(emptyOverlay());
  });

  it("replaces the whole serialized overlay in one write", () => {
    const storage = new MemoryKeyValueStorage();
    const store = new MutationOverlayStore(storage);
    store.write(populated);

    const raw = storage.getItem(MUTATION_OVERLAY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(populated);
  });

  it("survives adapter recreation over the same storage", () => {
    const storage = new MemoryKeyValueStorage();
    new MutationOverlayStore(storage).write(populated);

    const rebuilt = new MutationOverlayStore(storage);
    expect(rebuilt.read()).toEqual(populated);
  });

  it("degrades to an empty overlay when persisted data is corrupt", () => {
    expect(new MutationOverlayStore(seeded("{broken")).read()).toEqual(emptyOverlay());
  });

  it("degrades to an empty overlay when reading throws", () => {
    const hostile: KeyValueStorage = {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {},
      removeItem() {},
    };
    expect(new MutationOverlayStore(hostile).read()).toEqual(emptyOverlay());
  });

  it("propagates a write failure instead of swallowing it", () => {
    const hostile: KeyValueStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("quota exceeded");
      },
      removeItem() {},
    };
    expect(() => new MutationOverlayStore(hostile).write(populated)).toThrow();
  });

  it("clear() removes the overlay and leaves an empty one behind", () => {
    const storage = seeded(JSON.stringify(populated));
    const store = new MutationOverlayStore(storage);
    expect(store.read().notes).toHaveLength(1);

    store.clear();
    expect(storage.getItem(MUTATION_OVERLAY_STORAGE_KEY)).toBeNull();
    expect(store.read()).toEqual(emptyOverlay());
  });
});

describe("fingerprint", () => {
  it("is deterministic across calls", () => {
    const input = { userId: "u_001", actorId: "emp_a", role: "crm_admin", body: "текст" };
    expect(fingerprintAddNote(input)).toBe(fingerprintAddNote(input));
  });

  it("changes with user, actor, role or body", () => {
    const base = { userId: "u_001", actorId: "emp_a", role: "crm_admin", body: "текст" };
    const fp = fingerprintAddNote(base);
    expect(fingerprintAddNote({ ...base, userId: "u_002" })).not.toBe(fp);
    expect(fingerprintAddNote({ ...base, actorId: "emp_b" })).not.toBe(fp);
    expect(fingerprintAddNote({ ...base, role: "support" })).not.toBe(fp);
    expect(fingerprintAddNote({ ...base, body: "другой" })).not.toBe(fp);
  });

  it("does not confuse different part boundaries", () => {
    // Without length-prefixing, ("ab","c") and ("a","bc") would serialize alike.
    expect(stableFingerprint(["ab", "c"])).not.toBe(stableFingerprint(["a", "bc"]));
  });

  it("does not contain the body in plain text", () => {
    const fp = fingerprintAddNote({
      userId: "u_001",
      actorId: "emp_a",
      role: "crm_admin",
      body: "секретный текст заметки",
    });
    expect(fp).not.toContain("секретный");
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});

/**
 * Canonical note projector (Phase 1B4-A). These tests pin the privacy rule
 * itself; the provider-level consequences live in notes-privacy.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CRM_ROLES } from "@/domain/identity/roles";
import {
  canViewNote,
  hideDeletedNotes,
  projectNotes,
  resolveEffectivePins,
  sortNotes,
} from "./note-projection";
import { normalizeNoteBody, NOTE_BODY_MAX_LENGTH, mockNoteId } from "./note";
import type { CrmNote, NoteVisibility } from "./note";
import type {
  AuditRecord,
  NoteDeletedAuditRecord,
  NotePinChangedAuditRecord,
} from "@/domain/audit/audit";

function note(over: Partial<CrmNote> = {}): CrmNote {
  return {
    id: "note_mock_0001",
    userId: "u_001",
    caseId: null,
    authorEmployeeId: "emp_author",
    body: "Тело заметки",
    visibility: "team",
    pinned: false,
    createdAt: "2026-07-13T09:00:00.001Z",
    updatedAt: "2026-07-13T09:00:00.001Z",
    mock: true,
    ...over,
  };
}

describe("canViewNote — team", () => {
  it("is visible to every role, since every role can open User 360 (matrix §2)", () => {
    for (const role of CRM_ROLES) {
      expect(canViewNote(note({ visibility: "team" }), { actorId: "emp_x", role })).toBe(true);
    }
  });
});

describe("canViewNote — private (fail-closed)", () => {
  it("is visible to its author", () => {
    expect(
      canViewNote(note({ visibility: "private", authorEmployeeId: "emp_author" }), {
        actorId: "emp_author",
        role: "support",
      }),
    ).toBe(true);
  });

  it("is hidden from every non-author role, including admin and manager", () => {
    for (const role of CRM_ROLES) {
      expect(
        canViewNote(note({ visibility: "private", authorEmployeeId: "emp_author" }), {
          actorId: "emp_someone_else",
          role,
        }),
      ).toBe(false);
    }
  });

  it("is hidden from everyone when the author is unknown", () => {
    for (const role of CRM_ROLES) {
      expect(
        canViewNote(note({ visibility: "private", authorEmployeeId: "" }), { actorId: "", role }),
      ).toBe(false);
    }
  });
});

describe("canViewNote — role_restricted (fail-closed)", () => {
  it("is hidden from every role: the model carries no allowed-roles metadata", () => {
    for (const role of CRM_ROLES) {
      expect(canViewNote(note({ visibility: "role_restricted" }), { actorId: "emp_x", role })).toBe(
        false,
      );
    }
  });

  it("is hidden even from its own author", () => {
    expect(
      canViewNote(note({ visibility: "role_restricted", authorEmployeeId: "emp_author" }), {
        actorId: "emp_author",
        role: "crm_admin",
      }),
    ).toBe(false);
  });
});

describe("canViewNote — unknown visibility", () => {
  it("denies a value the enum does not know", () => {
    const rogue = note({ visibility: "everyone" as NoteVisibility });
    expect(canViewNote(rogue, { actorId: "emp_x", role: "crm_admin" })).toBe(false);
  });
});

describe("projectNotes", () => {
  it("removes hidden notes rather than replacing them with a placeholder", () => {
    const notes = [
      note({ id: "a", visibility: "team" }),
      note({ id: "b", visibility: "private", authorEmployeeId: "emp_other" }),
      note({ id: "c", visibility: "role_restricted" }),
    ];
    const visible = projectNotes(notes, { actorId: "emp_me", role: "crm_admin" });

    expect(visible.map((n) => n.id)).toEqual(["a"]);
    expect(JSON.stringify(visible)).not.toContain("скрыт");
  });

  it("really depends on the actor", () => {
    const notes = [note({ id: "p", visibility: "private", authorEmployeeId: "emp_author" })];
    expect(projectNotes(notes, { actorId: "emp_author", role: "support" })).toHaveLength(1);
    expect(projectNotes(notes, { actorId: "emp_other", role: "support" })).toHaveLength(0);
  });
});

describe("sortNotes", () => {
  it("puts pinned first, then newest, then breaks ties by id", () => {
    const notes = [
      note({ id: "b", createdAt: "2026-07-13T09:00:00.000Z" }),
      note({ id: "a", createdAt: "2026-07-13T09:00:00.000Z" }),
      note({ id: "new", createdAt: "2026-07-13T10:00:00.000Z" }),
      note({ id: "pin", createdAt: "2020-01-01T00:00:00.000Z", pinned: true }),
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["pin", "new", "a", "b"]);
  });

  it("is stable across repeated calls and does not mutate its input", () => {
    const notes = [note({ id: "b" }), note({ id: "a" })];
    const first = sortNotes(notes).map((n) => n.id);
    expect(sortNotes(notes).map((n) => n.id)).toEqual(first);
    expect(notes.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("resolveEffectivePins", () => {
  function pinAudit(over: Partial<NotePinChangedAuditRecord>): NotePinChangedAuditRecord {
    return {
      id: "audit_mock_0001",
      action: "note_pin_changed",
      actorEmployeeId: "emp_author",
      actorRole: "crm_admin",
      targetUserId: "u_001",
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T09:00:00.001Z",
      reasonCode: "note_pin_changed_by_employee",
      previousPinned: false,
      nextPinned: true,
      mock: true,
      ...over,
    };
  }

  it("returns notes unchanged when there are no pin records", () => {
    const notes = [note({ id: "n1" }), note({ id: "n2" })];
    expect(resolveEffectivePins(notes, [])).toEqual(notes);
  });

  it("ignores audit records that are not pin changes", () => {
    const other: AuditRecord = {
      id: "audit_mock_0009",
      action: "note_added",
      actorEmployeeId: "emp_author",
      actorRole: "crm_admin",
      targetUserId: "u_001",
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T09:00:00.001Z",
      reasonCode: "note_added_by_employee",
      mock: true,
    };
    expect(resolveEffectivePins([note({ id: "note_mock_0001" })], [other])[0]!.pinned).toBe(false);
  });

  it("applies the pin to the matching note only", () => {
    const notes = [note({ id: "note_mock_0001" }), note({ id: "note_mock_0002" })];
    const out = resolveEffectivePins(notes, [pinAudit({ entityId: "note_mock_0001" })]);
    expect(out[0]!.pinned).toBe(true);
    expect(out[1]!.pinned).toBe(false);
  });

  it("the latest record by `at` wins, whatever the array order", () => {
    const records = [
      pinAudit({ id: "audit_mock_0003", at: "2026-07-13T12:00:00.000Z", nextPinned: false }),
      pinAudit({ id: "audit_mock_0001", at: "2026-07-13T09:00:00.000Z", nextPinned: true }),
      pinAudit({ id: "audit_mock_0002", at: "2026-07-13T10:00:00.000Z", nextPinned: true }),
    ];
    expect(resolveEffectivePins([note({ id: "note_mock_0001" })], records)[0]!.pinned).toBe(false);
  });

  it("breaks an equal-`at` tie by the higher audit id", () => {
    const at = "2026-07-13T09:00:00.000Z";
    const records = [
      pinAudit({ id: "audit_mock_0001", at, nextPinned: true }),
      pinAudit({ id: "audit_mock_0002", at, nextPinned: false }),
    ];
    expect(resolveEffectivePins([note({ id: "note_mock_0001" })], records)[0]!.pinned).toBe(false);
  });

  it("does not mutate the input notes — a changed note is a clone", () => {
    const original = note({ id: "note_mock_0001", pinned: false });
    const out = resolveEffectivePins([original], [pinAudit({})]);
    expect(original.pinned).toBe(false);
    expect(out[0]).not.toBe(original);
    expect(out[0]!.pinned).toBe(true);
  });

  it("returns the same note object when the resolved state equals the baseline", () => {
    const unchanged = note({ id: "note_mock_0001", pinned: false });
    // A pin then an unpin resolves back to false — same as the baseline.
    const out = resolveEffectivePins([unchanged], [
      pinAudit({ id: "audit_mock_0001", at: "2026-07-13T09:00:00.000Z", nextPinned: true }),
      pinAudit({ id: "audit_mock_0002", at: "2026-07-13T10:00:00.000Z", nextPinned: false }),
    ]);
    expect(out[0]).toBe(unchanged);
  });
});

describe("hideDeletedNotes", () => {
  function deleteAudit(over: Partial<NoteDeletedAuditRecord> = {}): NoteDeletedAuditRecord {
    return {
      id: "audit_mock_0002",
      action: "note_deleted",
      actorEmployeeId: "emp_author",
      actorRole: "crm_admin",
      targetUserId: "u_001",
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T10:00:00.000Z",
      reasonCode: "note_deleted_by_employee",
      mock: true,
      ...over,
    };
  }

  it("returns notes unchanged when there are no delete records", () => {
    const notes = [note({ id: "n1" }), note({ id: "n2" })];
    expect(hideDeletedNotes(notes, [])).toEqual(notes);
  });

  it("ignores audit records that are not deletions", () => {
    const pin: AuditRecord = {
      id: "audit_mock_0009",
      action: "note_pin_changed",
      actorEmployeeId: "emp_author",
      actorRole: "crm_admin",
      targetUserId: "u_001",
      entityType: "note",
      entityId: "note_mock_0001",
      at: "2026-07-13T10:00:00.000Z",
      reasonCode: "note_pin_changed_by_employee",
      previousPinned: false,
      nextPinned: true,
      mock: true,
    };
    expect(hideDeletedNotes([note({ id: "note_mock_0001" })], [pin])).toHaveLength(1);
  });

  it("hides a note whose delete record is at or after its updatedAt", () => {
    const notes = [note({ id: "note_mock_0001", updatedAt: "2026-07-13T09:00:00.000Z" })];
    expect(hideDeletedNotes(notes, [deleteAudit()])).toHaveLength(0);
  });

  it("hides the matching note only, leaving others in place", () => {
    const notes = [
      note({ id: "note_mock_0001", updatedAt: "2026-07-13T09:00:00.000Z" }),
      note({ id: "note_mock_0002", updatedAt: "2026-07-13T09:00:00.000Z" }),
    ];
    const out = hideDeletedNotes(notes, [deleteAudit({ entityId: "note_mock_0001" })]);
    expect(out.map((n) => n.id)).toEqual(["note_mock_0002"]);
  });

  it("does NOT hide a note written after the delete claim (stale/corrupt record)", () => {
    const notes = [note({ id: "note_mock_0001", updatedAt: "2026-07-13T11:00:00.000Z" })];
    // Delete at 10:00, note updatedAt 11:00 → the note is newer, so the delete is stale.
    expect(hideDeletedNotes(notes, [deleteAudit({ at: "2026-07-13T10:00:00.000Z" })])).toHaveLength(1);
  });

  it("resolves the latest delete record by at, then id — a later delete still hides", () => {
    const notes = [note({ id: "note_mock_0001", updatedAt: "2026-07-13T09:30:00.000Z" })];
    const records = [
      deleteAudit({ id: "audit_mock_0002", at: "2026-07-13T09:00:00.000Z" }), // predates the note
      deleteAudit({ id: "audit_mock_0003", at: "2026-07-13T10:00:00.000Z" }), // later — wins, hides
    ];
    expect(hideDeletedNotes(notes, records)).toHaveLength(0);
  });

  it("ignores a delete record with an unparseable timestamp", () => {
    const notes = [note({ id: "note_mock_0001" })];
    expect(hideDeletedNotes(notes, [deleteAudit({ at: "not-a-date" })])).toHaveLength(1);
  });

  it("does not mutate its input", () => {
    const notes = [note({ id: "note_mock_0001", updatedAt: "2026-07-13T09:00:00.000Z" })];
    const copy = [...notes];
    hideDeletedNotes(notes, [deleteAudit()]);
    expect(notes).toEqual(copy);
  });
});

describe("normalizeNoteBody", () => {
  it("trims", () => {
    expect(normalizeNoteBody("  текст  ")).toEqual({ ok: true, body: "текст" });
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(normalizeNoteBody("")).toEqual({ ok: false, error: "empty" });
    expect(normalizeNoteBody("   \n\t ")).toEqual({ ok: false, error: "empty" });
  });

  it("accepts the limit and rejects one character past it, measured after trim", () => {
    const atLimit = "x".repeat(NOTE_BODY_MAX_LENGTH);
    expect(normalizeNoteBody(atLimit)).toEqual({ ok: true, body: atLimit });
    expect(normalizeNoteBody(` ${atLimit} `)).toEqual({ ok: true, body: atLimit });
    expect(normalizeNoteBody("x".repeat(NOTE_BODY_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
  });
});

describe("mockNoteId", () => {
  it("is derived from the sequence and is zero-padded", () => {
    expect(mockNoteId(1)).toBe("note_mock_0001");
    expect(mockNoteId(42)).toBe("note_mock_0042");
    expect(mockNoteId(1)).toBe(mockNoteId(1));
  });
});

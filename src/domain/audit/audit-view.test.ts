/**
 * Canonical audit sorter/projector (Phase 1B5-B). The append-only log is ordered
 * newest-first with a stable id tie-break, projected to a safe view that never
 * carries a raw id, a note body or a reason code, and the source array is never
 * mutated. The resolvers used here are the REAL `ownerLabel` (config) plus a
 * dataset-style name map, so the fallback captions are exercised end-to-end.
 */
import { describe, expect, it } from "vitest";
import {
  projectAuditRecord,
  projectAuditRecords,
  sortAuditRecords,
  type AuditViewResolvers,
} from "./audit-view";
import type {
  AuditRecord,
  NoteAddedAuditRecord,
  NoteBodyChangedAuditRecord,
  NoteDeletedAuditRecord,
  NotePinChangedAuditRecord,
  NoteVisibilityChangedAuditRecord,
  PrimaryOwnerChangedAuditRecord,
} from "./audit";
import { ownerLabel, UNKNOWN_USER_LABEL } from "@/config/labels";

/** «Retention 1» in the canonical directory — a known employee. */
const KNOWN_ACTOR = "emp_ret1";
const KNOWN_TARGET = "usr_known_1";
const TARGET_NAMES = new Map<string, string>([[KNOWN_TARGET, "Иван Пример"]]);

const resolvers: AuditViewResolvers = {
  employeeName: (id) => ownerLabel(id),
  ownerName: (id) => ownerLabel(id),
  userName: (id) => TARGET_NAMES.get(id) ?? UNKNOWN_USER_LABEL,
};

function noteAdded(id: string, at: string): NoteAddedAuditRecord {
  return {
    id,
    action: "note_added",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "note",
    entityId: "note_mock_0001",
    at,
    reasonCode: "note_added_by_employee",
    mock: true,
  };
}

function ownerChanged(
  id: string,
  at: string,
  previousOwnerId: string | null,
  nextOwnerId: string | null,
): PrimaryOwnerChangedAuditRecord {
  return {
    id,
    action: "primary_owner_changed",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "user",
    entityId: KNOWN_TARGET,
    at,
    reasonCode: "primary_owner_changed_by_employee",
    previousOwnerId,
    nextOwnerId,
    mock: true,
  };
}

function pinChanged(id: string, at: string, nextPinned: boolean): NotePinChangedAuditRecord {
  return {
    id,
    action: "note_pin_changed",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "note",
    entityId: "note_mock_0002",
    at,
    reasonCode: "note_pin_changed_by_employee",
    previousPinned: !nextPinned,
    nextPinned,
    mock: true,
  };
}

function bodyChanged(id: string, at: string): NoteBodyChangedAuditRecord {
  return {
    id,
    action: "note_body_changed",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "note",
    entityId: "note_mock_0003",
    at,
    reasonCode: "note_body_changed_by_employee",
    mock: true,
  };
}

function visibilityChanged(
  id: string,
  at: string,
  previousVisibility: "team" | "private",
  nextVisibility: "team" | "private",
): NoteVisibilityChangedAuditRecord {
  return {
    id,
    action: "note_visibility_changed",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "note",
    entityId: "note_mock_0004",
    at,
    reasonCode: "note_visibility_changed_by_employee",
    previousVisibility,
    nextVisibility,
    mock: true,
  };
}

function noteDeleted(id: string, at: string): NoteDeletedAuditRecord {
  return {
    id,
    action: "note_deleted",
    actorEmployeeId: KNOWN_ACTOR,
    actorRole: "crm_admin",
    targetUserId: KNOWN_TARGET,
    entityType: "note",
    entityId: "note_mock_0005",
    at,
    reasonCode: "note_deleted_by_employee",
    mock: true,
  };
}

describe("sortAuditRecords — order", () => {
  it("orders by `at` descending (newest first)", () => {
    const records: AuditRecord[] = [
      noteAdded("audit_mock_0001", "2026-07-01T00:00:00.000Z"),
      noteAdded("audit_mock_0002", "2026-07-03T00:00:00.000Z"),
      noteAdded("audit_mock_0003", "2026-07-02T00:00:00.000Z"),
    ];
    const sorted = sortAuditRecords(records);
    expect(sorted.map((r) => r.id)).toEqual([
      "audit_mock_0002",
      "audit_mock_0003",
      "audit_mock_0001",
    ]);
  });

  it("breaks an equal `at` by `id` descending", () => {
    const at = "2026-07-01T00:00:00.000Z";
    const records: AuditRecord[] = [
      noteAdded("audit_mock_0001", at),
      noteAdded("audit_mock_0003", at),
      noteAdded("audit_mock_0002", at),
    ];
    const sorted = sortAuditRecords(records);
    expect(sorted.map((r) => r.id)).toEqual([
      "audit_mock_0003",
      "audit_mock_0002",
      "audit_mock_0001",
    ]);
  });

  it("does not mutate the source array — it sorts a copy", () => {
    const records: AuditRecord[] = [
      noteAdded("audit_mock_0001", "2026-07-01T00:00:00.000Z"),
      noteAdded("audit_mock_0002", "2026-07-03T00:00:00.000Z"),
    ];
    const before = records.map((r) => r.id);
    const sorted = sortAuditRecords(records);
    expect(records.map((r) => r.id)).toEqual(before);
    expect(sorted).not.toBe(records);
  });

  it("is stable across repeated reads of the same input", () => {
    const at = "2026-07-01T00:00:00.000Z";
    const records: AuditRecord[] = [
      noteAdded("audit_mock_0002", at),
      noteAdded("audit_mock_0001", "2026-07-05T00:00:00.000Z"),
      noteAdded("audit_mock_0003", at),
    ];
    const first = sortAuditRecords(records).map((r) => r.id);
    const second = sortAuditRecords(records).map((r) => r.id);
    expect(second).toEqual(first);
  });
});

describe("projectAuditRecord — all four actions", () => {
  it("projects note_added", () => {
    const view = projectAuditRecord(noteAdded("audit_mock_0001", "2026-07-01T00:00:00.000Z"), resolvers);
    expect(view).toEqual({
      id: "audit_mock_0001",
      action: "note_added",
      at: "2026-07-01T00:00:00.000Z",
      actorName: "Retention 1",
      targetUserName: "Иван Пример",
      mock: true,
    });
  });

  it("projects primary_owner_changed with resolved before/after owner names", () => {
    const view = projectAuditRecord(
      ownerChanged("audit_mock_0002", "2026-07-01T00:00:00.000Z", "emp_men1", "emp_sup1"),
      resolvers,
    );
    expect(view).toMatchObject({
      action: "primary_owner_changed",
      actorName: "Retention 1",
      targetUserName: "Иван Пример",
      previousOwnerName: "Mentor 1",
      nextOwnerName: "Support 1",
    });
  });

  it("derives pin direction from nextPinned", () => {
    const pinned = projectAuditRecord(pinChanged("audit_mock_0003", "2026-07-01T00:00:00.000Z", true), resolvers);
    const unpinned = projectAuditRecord(pinChanged("audit_mock_0004", "2026-07-01T00:00:00.000Z", false), resolvers);
    expect(pinned).toMatchObject({ action: "note_pin_changed", pinned: true });
    expect(unpinned).toMatchObject({ action: "note_pin_changed", pinned: false });
  });

  it("projects note_body_changed with base fields only", () => {
    const view = projectAuditRecord(bodyChanged("audit_mock_0005", "2026-07-01T00:00:00.000Z"), resolvers);
    expect(view).toEqual({
      id: "audit_mock_0005",
      action: "note_body_changed",
      at: "2026-07-01T00:00:00.000Z",
      actorName: "Retention 1",
      targetUserName: "Иван Пример",
      mock: true,
    });
  });

  it("projects note_visibility_changed WITHOUT the direction — base fields only", () => {
    const view = projectAuditRecord(
      visibilityChanged("audit_mock_0006", "2026-07-01T00:00:00.000Z", "team", "private"),
      resolvers,
    );
    // The previous/next visibility MUST NOT reach the view: the global log never
    // discloses that a note is now hidden (D-91).
    expect(view).toEqual({
      id: "audit_mock_0006",
      action: "note_visibility_changed",
      at: "2026-07-01T00:00:00.000Z",
      actorName: "Retention 1",
      targetUserName: "Иван Пример",
      mock: true,
    });
    expect(JSON.stringify(view)).not.toContain("private");
    expect(JSON.stringify(view)).not.toContain("team");
    expect("previousVisibility" in view).toBe(false);
    expect("nextVisibility" in view).toBe(false);
  });

  it("projects note_deleted with base fields only — no body, visibility or entity id", () => {
    const view = projectAuditRecord(noteDeleted("audit_mock_0007", "2026-07-01T00:00:00.000Z"), resolvers);
    expect(view).toEqual({
      id: "audit_mock_0007",
      action: "note_deleted",
      at: "2026-07-01T00:00:00.000Z",
      actorName: "Retention 1",
      targetUserName: "Иван Пример",
      mock: true,
    });
    // The deleted note's id is never projected as visible text.
    expect(JSON.stringify(view)).not.toContain("note_mock_0005");
    expect("entityId" in view).toBe(false);
  });
});

describe("projectAuditRecord — safe name resolution", () => {
  it("resolves a null owner to «Не назначен» on either side", () => {
    const view = projectAuditRecord(
      ownerChanged("audit_mock_0006", "2026-07-01T00:00:00.000Z", null, null),
      resolvers,
    );
    expect(view).toMatchObject({
      action: "primary_owner_changed",
      previousOwnerName: "Не назначен",
      nextOwnerName: "Не назначен",
    });
  });

  it("resolves an unknown employee id to «Неизвестный сотрудник», never the raw id", () => {
    const record = noteAdded("audit_mock_0007", "2026-07-01T00:00:00.000Z");
    const view = projectAuditRecord({ ...record, actorEmployeeId: "emp_ghost_999" }, resolvers);
    expect(view.actorName).toBe("Неизвестный сотрудник");
    expect(view.actorName).not.toContain("emp_ghost_999");
  });

  it("resolves an unknown target user to «Неизвестный пользователь», never the raw id", () => {
    const record = noteAdded("audit_mock_0008", "2026-07-01T00:00:00.000Z");
    const view = projectAuditRecord({ ...record, targetUserId: "usr_ghost_999" }, resolvers);
    expect(view.targetUserName).toBe("Неизвестный пользователь");
    expect(view.targetUserName).not.toContain("usr_ghost_999");
  });
});

describe("projectAuditRecords — privacy of the view", () => {
  const records: AuditRecord[] = [
    noteAdded("audit_mock_0001", "2026-07-01T00:00:00.000Z"),
    ownerChanged("audit_mock_0002", "2026-07-02T00:00:00.000Z", "emp_men1", null),
    pinChanged("audit_mock_0003", "2026-07-03T00:00:00.000Z", true),
    bodyChanged("audit_mock_0004", "2026-07-04T00:00:00.000Z"),
  ];

  it("carries no raw employee id, note id, user id, body or reason code", () => {
    const views = projectAuditRecords(records, resolvers);
    const serialized = JSON.stringify(views);
    // Raw ids that exist on the source records must not surface in the view.
    expect(serialized).not.toContain("emp_ret1");
    expect(serialized).not.toContain("emp_men1");
    expect(serialized).not.toContain("usr_known_1");
    expect(serialized).not.toContain("note_mock_");
    expect(serialized).not.toContain("_by_employee"); // reason codes
    expect(serialized).not.toContain("entityId");
  });

  it("keeps the newest-first order after projection", () => {
    const views = projectAuditRecords(records, resolvers);
    expect(views.map((v) => v.id)).toEqual([
      "audit_mock_0004",
      "audit_mock_0003",
      "audit_mock_0002",
      "audit_mock_0001",
    ]);
  });
});

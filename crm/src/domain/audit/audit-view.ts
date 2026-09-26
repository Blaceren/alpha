/**
 * Safe, UI-facing projection of the append-only audit log (Phase 1B5-B).
 *
 * The UI must NEVER receive a raw storage `AuditRecord`. A record carries the
 * actor's employee id, the target user's id, the note's entity id, a reason code
 * and a `mock` marker — all internal, and two of them (raw ids) are things the
 * audit screen is explicitly forbidden to print. `AuditRecordView` is the
 * provider-owned read model that replaces every id with a resolved human caption
 * and carries nothing else: no employee id, no note id, no user id as visible
 * text, no body, no reason code, no storage diagnostics.
 *
 * `id` survives only as a stable React key and a sort tie-break; it is never
 * rendered. It is the audit record's own id (`audit_mock_*`) and MUST NOT reach
 * the DOM as text — the component uses it as `key` and nothing else.
 *
 * Privacy note (D3, D-91): the global `/audit` is gated to the two Full roles, who
 * may see every note, so no note-visibility-aware filtering is applied to this
 * global view. Phase 1B5-C lets a note become `private`, and the
 * `note_visibility_changed` view carries base fields only — never the direction —
 * so the log never discloses that a note is now hidden. The moment a
 * note-scoped audit surface is shown to a Limited role (a User 360 audit-preview,
 * still deferred — D-90/D-91), those records must pass a canonical note-visibility
 * projection BEFORE reaching a view.
 */
import type { EmployeeId, ISODateString, UserId } from "@/domain/shared/primitives";
import type { AuditRecord } from "./audit";

/**
 * Discriminated read model, one member per audit action. Deliberately carries
 * only resolved names and the pin direction — never a raw id, a note body, a
 * reason code or a fragment of anything the employee typed.
 */
export type AuditRecordView =
  | {
      id: string;
      action: "note_added";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      mock: true;
    }
  | {
      id: string;
      action: "primary_owner_changed";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      previousOwnerName: string;
      nextOwnerName: string;
      mock: true;
    }
  | {
      id: string;
      action: "note_pin_changed";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      /** Direction of the pin change. The UI renders it as words, never a colour. */
      pinned: boolean;
      mock: true;
    }
  | {
      id: string;
      action: "note_body_changed";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      mock: true;
    }
  | {
      id: string;
      action: "note_visibility_changed";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      mock: true;
    }
  | {
      id: string;
      action: "note_deleted";
      at: ISODateString;
      actorName: string;
      targetUserName: string;
      mock: true;
    };

/**
 * How the projector turns internal ids into captions. Supplied by the provider,
 * which owns the canonical directory (`ownerLabel`) and the dataset — the domain
 * layer must not import config copy or the mock fixtures, so it takes the answers
 * rather than computing them.
 *
 *   - `employeeName` resolves an actor id (always present).
 *   - `ownerName` resolves an owner id that may be `null` (unassigned).
 *   - `userName` resolves the target user id.
 *
 * A raw id is NEVER an acceptable fallback: each resolver must return a safe
 * caption («Неизвестный сотрудник» / «Не назначен» / «Неизвестный пользователь»)
 * for an id it cannot place. The projector never reads an id string into the view.
 */
export interface AuditViewResolvers {
  employeeName(id: EmployeeId): string;
  ownerName(id: EmployeeId | null): string;
  userName(id: UserId): string;
}

/**
 * Canonical audit order: newest first by `at`, then by `id` descending as a
 * stable tie-break. Never relies on the position of a record in
 * `overlay.auditRecords`, and never mutates the input — it sorts a copy, because
 * the array it is handed is the append-only log itself.
 *
 * `id` descending is total and reproducible: audit ids are the zero-padded
 * `audit_mock_NNNN`, so for a shared `at` the later-sequenced record sorts first,
 * matching the write order without depending on it.
 */
export function sortAuditRecords(records: readonly AuditRecord[]): AuditRecord[] {
  return [...records].sort((a, b) => {
    const at = Date.parse(b.at) - Date.parse(a.at);
    if (at !== 0) return at;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Project a single record to its safe view. Pure structural mapping. */
export function projectAuditRecord(
  record: AuditRecord,
  resolvers: AuditViewResolvers,
): AuditRecordView {
  const base = {
    id: record.id,
    at: record.at,
    actorName: resolvers.employeeName(record.actorEmployeeId),
    targetUserName: resolvers.userName(record.targetUserId),
    mock: true as const,
  };

  switch (record.action) {
    case "note_added":
      return { ...base, action: "note_added" };
    case "primary_owner_changed":
      return {
        ...base,
        action: "primary_owner_changed",
        previousOwnerName: resolvers.ownerName(record.previousOwnerId),
        nextOwnerName: resolvers.ownerName(record.nextOwnerId),
      };
    case "note_pin_changed":
      // Direction comes from `nextPinned` — the state the change moved TO.
      return { ...base, action: "note_pin_changed", pinned: record.nextPinned };
    case "note_body_changed":
      // The strictest: base fields only. No old or new body, no fragment, no length.
      return { ...base, action: "note_body_changed" };
    case "note_visibility_changed":
      // Base fields only. The `previous`/`next` visibility direction is deliberately
      // NOT projected — the global log states only THAT access changed, never which
      // way, so it can never disclose that a note is now hidden (D-91).
      return { ...base, action: "note_visibility_changed" };
    case "note_deleted":
      // Base fields only (Phase 1B6). The deleted note's body, former visibility, pin
      // state and id are all withheld — the log states only THAT a note was removed
      // and by whom, never what it contained (D-99).
      return { ...base, action: "note_deleted" };
  }
}

/**
 * The one canonical read: sort newest-first, then project every record to its
 * safe view. Callers (the provider) paginate the result; ordering and projection
 * are decided here so a second reader cannot grow a second answer.
 */
export function projectAuditRecords(
  records: readonly AuditRecord[],
  resolvers: AuditViewResolvers,
): AuditRecordView[] {
  return sortAuditRecords(records).map((record) => projectAuditRecord(record, resolvers));
}

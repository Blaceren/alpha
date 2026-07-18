/**
 * The single canonical note privacy rule.
 *
 * Every read of notes goes through this module. Today `getUserNotes` is the only
 * reader — User 360 does not read notes at all — but the rule lives here rather
 * than inside the provider method so a second reader cannot grow a second answer
 * to "who may see this note", which is the failure D-39/D-40 already had to undo
 * for the timeline and for hidden financials.
 *
 * Fail-closed by construction: visibility is granted by an explicit branch and
 * everything else returns false.
 */
import type { EmployeeId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type { CrmNote } from "@/domain/notes/note";
import type { AuditRecord } from "@/domain/audit/audit";

/** Who is asking. Comes from the trusted provider context, never from a command. */
export interface NoteActor {
  actorId: EmployeeId;
  role: CrmRole;
}

/**
 * `team` — visible to every role that can open User 360, which per
 * ROLE_PERMISSION_MATRIX §2 is all nine roles. Note visibility is per-note, so
 * no role is refused the read outright; the projection decides each note.
 *
 * `private` — author only. The contract states two different rules for it
 * (§7 input comment says "автору/manager+", §7 Filters says "только автор"), so
 * the narrower one wins: an author always qualifies under both readings, a
 * manager only under one. See DECISIONS D-55.
 *
 * `role_restricted` — always hidden. The model carries no allowed-roles metadata,
 * so "restricted to which roles?" has no answer to evaluate. An unanswerable
 * question is denied, not guessed.
 */
export function canViewNote(note: CrmNote, actor: NoteActor): boolean {
  if (note.visibility === "team") return true;
  if (note.visibility === "private") {
    return note.authorEmployeeId.length > 0 && note.authorEmployeeId === actor.actorId;
  }
  return false;
}

/**
 * Drop every note the actor may not see. Hidden notes are removed, not replaced
 * with a placeholder: a "скрыто" row would disclose that the note exists, and
 * filtering before pagination keeps them out of `page.total` as well.
 */
export function projectNotes(notes: readonly CrmNote[], actor: NoteActor): CrmNote[] {
  return notes.filter((note) => canViewNote(note, actor));
}

/**
 * The single canonical way to know a note's CURRENT pinned state (Phase 1B4-D).
 *
 * `note.pinned` is the note's BASELINE — `false` on every fixture and authored
 * note, since a note is never born pinned. A pin/unpin is recorded as a
 * `note_pin_changed` audit entry, NOT by rewriting the note: fixtures are
 * immutable and authored notes are not mutated for pin state either, so the
 * effective value is the baseline overridden by the LATEST matching audit record.
 * This mirrors D-65/D-70's owner resolver: the append-only log is the state, so a
 * second store cannot disagree with it.
 *
 * "Latest" is resolved deterministically by `at`, then by audit `id` — never by
 * array position. Every read that shows a note's pinned state must go through
 * here, and it must run BEFORE `sortNotes`, or the pinned-first order would sort
 * on the stale baseline. Neither the fixture nor the overlay note is mutated: a
 * changed note is a shallow clone with the resolved `pinned`.
 */
export function resolveEffectivePins(
  notes: readonly CrmNote[],
  auditRecords: readonly AuditRecord[],
): CrmNote[] {
  const latest = new Map<string, { at: number; id: string; pinned: boolean }>();
  for (const record of auditRecords) {
    if (record.action !== "note_pin_changed") continue;
    const at = Date.parse(record.at);
    const prev = latest.get(record.entityId);
    // Later `at` wins; an equal `at` is broken by the higher audit id, so the
    // resolution is total and reproducible regardless of iteration order.
    if (!prev || at > prev.at || (at === prev.at && record.id > prev.id)) {
      latest.set(record.entityId, { at, id: record.id, pinned: record.nextPinned });
    }
  }
  if (latest.size === 0) return [...notes];
  return notes.map((note) => {
    const override = latest.get(note.id);
    if (!override || override.pinned === note.pinned) return note;
    return { ...note, pinned: override.pinned };
  });
}

/**
 * Drop every note that a valid `note_deleted` audit record has removed (Phase 1B6).
 *
 * A delete is a HARD delete — the note row is physically removed from the overlay
 * `notes[]` (D-96) — so in the ordinary case there is no row left for this to hide.
 * But the append-only audit log is the DEFENSIVE source of truth (D-97): a
 * corrupt/legacy overlay that still carries a note row AND a later `note_deleted`
 * record for it must present the note as gone, not resurrected. This is the single
 * place that resolves that, mirroring `resolveEffectivePins`: the log wins, so a
 * second opinion cannot disagree with it.
 *
 * "Later" is meant literally: a note is hidden only when the latest `note_deleted`
 * record for its id (resolved by `at` DESC, then audit `id` DESC — total and
 * reproducible, never array position) is at or after the note's own `updatedAt`. A
 * delete record that predates the note's last-known state is stale/corrupt and does
 * NOT hide it — the note was demonstrably written after that delete claim. Records
 * with an unparseable `at`, and notes with an unparseable `updatedAt`, are treated
 * conservatively: they never drive a hide.
 *
 * Runs BEFORE projection and ordering, so a deleted note is absent from `page.total`
 * as well as from `items` — exactly like a note the actor may not see. Fixture notes
 * are never deleted through the mutation path (it refuses them — D-96), so no
 * `note_deleted` record naming a fixture id is ever written, and a fixture cannot be
 * hidden this way. The input notes are never mutated: filtered, never cloned.
 */
export function hideDeletedNotes(
  notes: readonly CrmNote[],
  auditRecords: readonly AuditRecord[],
): CrmNote[] {
  const latestDelete = new Map<string, { at: number; id: string }>();
  for (const record of auditRecords) {
    if (record.action !== "note_deleted") continue;
    const at = Date.parse(record.at);
    if (Number.isNaN(at)) continue; // a corrupt timestamp never drives a hide
    const prev = latestDelete.get(record.entityId);
    if (!prev || at > prev.at || (at === prev.at && record.id > prev.id)) {
      latestDelete.set(record.entityId, { at, id: record.id });
    }
  }
  if (latestDelete.size === 0) return [...notes];
  return notes.filter((note) => {
    const del = latestDelete.get(note.id);
    if (!del) return true;
    const noteAt = Date.parse(note.updatedAt);
    // Hide only when the delete is at or after the note's last-known state. A delete
    // that predates a later write of the same id is stale and leaves the note visible.
    if (Number.isNaN(noteAt)) return true;
    return del.at < noteAt;
  });
}

/**
 * Contract order (§7): pinned first, then newest first. `id` breaks ties so that
 * notes created against a fixed mock clock keep a stable, reproducible order.
 * Operates on the pinned state it is given — apply `resolveEffectivePins` first.
 */
export function sortNotes(notes: readonly CrmNote[]): CrmNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const byRecency = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byRecency !== 0) return byRecency;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

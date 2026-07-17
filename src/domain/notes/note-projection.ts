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

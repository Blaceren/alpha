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
 * Contract order (§7): pinned first, then newest first. `id` breaks ties so that
 * notes created against a fixed mock clock keep a stable, reproducible order.
 */
export function sortNotes(notes: readonly CrmNote[]): CrmNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const byRecency = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byRecency !== 0) return byRecency;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

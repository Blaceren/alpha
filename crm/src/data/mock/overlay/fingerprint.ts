/**
 * Deterministic fingerprint of a normalized command + actor identity.
 *
 * Purpose: tell an idempotent replay ("same key, same command") from a key reused
 * for different content ("same key, different command" → conflict) WITHOUT
 * storing the note body in the receipt a second time in plain text.
 *
 * This is not a security primitive and does not pretend to be one — it guards
 * against accidental key reuse, not against an attacker constructing a
 * collision. That is why no crypto dependency is added (DECISIONS D-57): FNV-1a
 * is a few lines, has no dependency, and is byte-for-byte reproducible across
 * runs, which a mock's determinism requirement needs and a random UUID cannot
 * give.
 */

const FNV_PRIME = 0x01000193;
const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x1000193;

function fnv1a(input: string, offset: number): number {
  let hash = offset >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Length-prefix every part before joining. Without it, ("ab", "c") and ("a", "bc")
 * serialize identically and two different commands would look like a replay of
 * each other.
 *
 * Two hashes with different offsets are concatenated: 32 bits is small enough for
 * an accidental collision to be worth ruling out, and a second pass costs nothing.
 */
export function stableFingerprint(parts: readonly string[]): string {
  const serialized = parts.map((part) => `${part.length}:${part}`).join("");
  const a = fnv1a(serialized, OFFSET_A).toString(16).padStart(8, "0");
  const b = fnv1a(serialized, OFFSET_B).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

/**
 * The identity of an addNote command: which user, which actor, which role, which
 * normalized body. Any difference in any of the four is a different command, and
 * reusing a key across them is a conflict.
 *
 * The parts are NOT prefixed with the command name, and adding one now would be a
 * breaking change: every receipt already in a browser was fingerprinted without
 * it, so a retry of a note already written would stop matching its receipt and
 * report `conflict` instead of replaying. Commands are told apart by receipt kind
 * instead (docs/MUTATION_OVERLAY.md §5).
 */
export function fingerprintAddNote(input: {
  userId: string;
  actorId: string;
  role: string;
  body: string;
}): string {
  return stableFingerprint([input.userId, input.actorId, input.role, input.body]);
}

/**
 * Stands in for "no owner" inside the fingerprint. A literal empty string would
 * also work today — no employee id is empty — but it reads as "the field was left
 * out" rather than "the employee chose to clear the owner", and unassign is a
 * real command that must be distinguishable from every assign.
 *
 * It cannot collide with a real id: every synthetic employee id starts with
 * `emp_`, and the parts are length-prefixed regardless.
 */
export const UNASSIGNED_OWNER_TOKEN = "__unassigned__";

/**
 * The identity of an assignPrimaryOwner command: which user, which actor, which
 * role, which target owner.
 *
 * `expectedOwnerId` is deliberately NOT part of it. The fingerprint answers "what
 * was asked", and the precondition a command was sent under is not part of what
 * it asked for. Keeping it out is what makes a replay work: once a command has
 * been applied, the current owner IS the value it assigned, so re-sending it with
 * the original `expectedOwnerId` would be a stale precondition — and a repeat of
 * an already-succeeded write must return the original result, not a conflict
 * (docs/MUTATION_OVERLAY.md §5, pinned by test).
 */
export function fingerprintAssignPrimaryOwner(input: {
  userId: string;
  actorId: string;
  role: string;
  ownerId: string | null;
}): string {
  return stableFingerprint([
    input.userId,
    input.actorId,
    input.role,
    input.ownerId ?? UNASSIGNED_OWNER_TOKEN,
  ]);
}

/**
 * The identity of a setNotePinned command (Phase 1B4-D): which user, which note,
 * which actor, which role, which DESIRED pinned state.
 *
 * `expectedPinned` is deliberately NOT part of it, for the same reason
 * `expectedOwnerId` is not part of the owner fingerprint: the fingerprint answers
 * "what was asked", and the precondition a command was sent under is not part of
 * what it asked for. Once a pin command has been applied the current state IS the
 * value it set, so re-sending it with the original `expectedPinned` would be a
 * stale precondition — and a repeat of an already-succeeded write must replay to
 * the original result, not conflict.
 *
 * The desired state is length-prefixed like every other part, so the two tokens
 * cannot collide with a note id or a role.
 */
export function fingerprintSetNotePinned(input: {
  userId: string;
  actorId: string;
  role: string;
  noteId: string;
  pinned: boolean;
}): string {
  return stableFingerprint([
    input.userId,
    input.actorId,
    input.role,
    input.noteId,
    input.pinned ? "pinned" : "unpinned",
  ]);
}

/**
 * The identity of an updateNoteBody command (Phase 1B4-E): which user, which note,
 * which actor, which role, which NORMALIZED body. Any difference in any part is a
 * different command, and reusing a key across them is a conflict.
 *
 * The `body` part MUST be the already-normalized body — the same value that is
 * stored on the note — so that "  text  " and "text" fingerprint identically and a
 * retry that trims differently still replays. The receipt stores only this hash,
 * never the body itself, so the body is not duplicated in plain text (D-84).
 *
 * `expectedUpdatedAt` is deliberately NOT part of it, for the same reason
 * `expectedOwnerId`/`expectedPinned` are excluded (D-72/D-78): the fingerprint
 * answers "what was asked", and the precondition a command was sent under is not
 * part of what it asked for. Once an edit has been applied the note's `updatedAt`
 * has advanced, so re-sending the command with the original `expectedUpdatedAt`
 * would be a stale precondition — and a repeat of an already-succeeded write must
 * replay to the original result, not conflict.
 */
export function fingerprintUpdateNoteBody(input: {
  userId: string;
  actorId: string;
  role: string;
  noteId: string;
  body: string;
}): string {
  return stableFingerprint([
    input.userId,
    input.actorId,
    input.role,
    input.noteId,
    input.body,
  ]);
}

/**
 * The identity of a setNoteVisibility command (Phase 1B5-C): which user, which
 * note, which actor, which role, which DESIRED visibility. Any difference in any
 * part is a different command, and reusing a key across them is a conflict.
 *
 * `expectedUpdatedAt` is deliberately NOT part of it, for the same reason
 * `expectedOwnerId`/`expectedPinned`/`expectedUpdatedAt` are excluded from the
 * owner/pin/body fingerprints (D-72/D-78/D-83): the fingerprint answers "what was
 * asked", and the precondition a command was sent under is not part of that. Once a
 * visibility change has been applied the note's `updatedAt` has advanced, so a safe
 * retry with the original precondition must still replay, not conflict. The
 * visibility token is length-prefixed like every other part, so it cannot collide
 * with a note id or a role.
 */
export function fingerprintSetNoteVisibility(input: {
  userId: string;
  actorId: string;
  role: string;
  noteId: string;
  visibility: "team" | "private";
}): string {
  return stableFingerprint([
    input.userId,
    input.actorId,
    input.role,
    input.noteId,
    input.visibility,
  ]);
}

/**
 * The identity of a deleteNote command (Phase 1B6): which user, which note, which
 * actor, which role. Any difference in any part is a different command, and reusing
 * a key across them is a conflict — a key spent deleting user A's note is not the
 * same command as deleting user B's, another actor's, or under another role.
 *
 * `expectedUpdatedAt` is deliberately NOT part of it, for the same reason it is
 * excluded from the body/visibility fingerprints (D-83/D-93): the fingerprint answers
 * "what was asked", and the precondition a command was sent under is not part of that.
 * A delete has no "desired end-state value" like a body or visibility — the identity
 * IS which note, so there is no fifth part. This is what lets a retry after the note
 * has vanished still replay: the fingerprint depends on nothing the delete destroyed.
 */
export function fingerprintDeleteNote(input: {
  userId: string;
  actorId: string;
  role: string;
  noteId: string;
}): string {
  return stableFingerprint([input.userId, input.actorId, input.role, input.noteId]);
}

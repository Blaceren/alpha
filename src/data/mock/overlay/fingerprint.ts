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
 */
export function fingerprintAddNote(input: {
  userId: string;
  actorId: string;
  role: string;
  body: string;
}): string {
  return stableFingerprint([input.userId, input.actorId, input.role, input.body]);
}

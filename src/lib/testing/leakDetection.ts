/**
 * AFD-5B2A-FINAL — leak detection for redaction assertions.
 *
 * WHY THIS EXISTS
 * Several suites prove that a secret, click id, player id, balance or amount
 * never reaches a log, an audit row or an API result. They did it with a raw
 * `String.prototype.includes` against a JSON dump. That is unsound in the
 * false-positive direction, because the same dump carries random identifiers:
 *
 *   balance 260 vs providerRequestId "pp-8bfefe8f-2609-47f9-8425-eb631f37be89"
 *                                                  ^^^^
 *
 * A run failed exactly there — `http_500 leaked 260` — with nothing leaked. The
 * assertion is a coin flip on every random id, and a redaction test that fails
 * at random teaches an operator to ignore it, which is worse than not having it.
 *
 * The fix does NOT weaken detection. A genuinely leaked value appears in JSON as
 * a *value*: `"amount":260`, `"amount":"260"`, `260,` — always delimited by JSON
 * punctuation. A coincidence appears glued to other identifier characters. So
 * the value must appear on token boundaries to count as a leak.
 *
 * Identifier characters (kept OUT of the boundary set, so a match against them
 * does NOT count): letters, digits, `_`, `-`, `.`. Hyphen and dot matter most —
 * they are what join UUID segments, decimal amounts and ISO timestamps.
 */

const IDENTIFIER_CHARACTER = /[0-9A-Za-z_.-]/;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `value` occurs in `haystack` as a whole token — i.e. not glued to
 * surrounding identifier characters.
 *
 * Empty and single-character values are rejected outright: they cannot carry
 * evidence of a leak and would match almost anything.
 */
export function leaksValue(haystack: string, value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const needle = String(value);
  if (needle.length < 2) return false;

  const pattern = new RegExp(escapeForRegExp(needle), "g");
  for (let match = pattern.exec(haystack); match !== null; match = pattern.exec(haystack)) {
    const before = match.index === 0 ? "" : haystack[match.index - 1];
    const afterIndex = match.index + needle.length;
    const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
    const boundedLeft = before === "" || !IDENTIFIER_CHARACTER.test(before);
    const boundedRight = after === "" || !IDENTIFIER_CHARACTER.test(after);
    if (boundedLeft && boundedRight) return true;
  }
  return false;
}

/** The first value from `values` that leaks, or `null` when none does. */
export function firstLeak(haystack: string, values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (leaksValue(haystack, value)) return String(value);
  }
  return null;
}
